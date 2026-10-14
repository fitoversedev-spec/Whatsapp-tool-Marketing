import type { Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createQuotationWithNumber,
  demotePrimaryQuotes,
  nextSequenceForYear,
  setDealQuotedValue,
  syncConversationDealValue,
  writeDealLineItems,
} from "@/lib/quotation/service";
import { requestApproval } from "../approvals";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import type { ApprovalExecutor, ApprovalExecutorResult } from "../executors";
import { refusal } from "../messaging/access";
import { approveQuoteInputSchema, requestDiscountInputSchema, type QuotePathInput } from "../schemas/quotes";
import type { AgentHandler } from "../withAgent";
import {
  applyDiscount,
  assertPriceable,
  DiscountError,
  parseStoredLines,
  quoteContentHash,
  round2,
  totalsMatchLines,
  type DiscountSpec,
} from "./logic";
import { APPROVE_QUOTE_TOOL, loadQuote, quoteDto } from "./store";

/**
 * Human sign-off on quotes.
 *
 *   submit_quote_for_approval  (the AI)   marks the draft "pending" and queues an
 *                                          approve_quote request in the approvals list
 *   approve_quote              (a person) NEVER for the AI; its executor runs when a person
 *                                          approves the request and marks the quote approved
 *   request_discount           (the AI)   queued for a person by withAgent; its executor runs
 *                                          after approval and applies ONLY the approved rates
 *                                          to a NEW revision, approved by that same person
 */

const contentHashOf = (q: Pick<Quotation, "sport" | "lengthFt" | "widthFt" | "lineItems" | "notes" | "validityDays">) =>
  quoteContentHash({
    sport: q.sport,
    lengthFt: q.lengthFt,
    widthFt: q.widthFt,
    lines: parseStoredLines(q.lineItems),
    notes: q.notes,
    validityDays: q.validityDays,
  });

const failure = (ctx: AgentContext, status: number, code: string, message: string): ApprovalExecutorResult => ({
  status,
  body: { error: { code, message, correlationId: ctx.correlationId } },
});

// ---- submit_quote_for_approval ------------------------------------------------------

export const submitQuoteForApproval: AgentHandler<QuotePathInput> = async ({ ctx, input }) => {
  const q = await loadQuote(input.quotationId);
  if (!q.agentOrigin) return refusal(ctx, "not_submittable", "The AI agent can only submit drafts it created itself.", 409, [q.id]);
  if (q.status !== "draft") return refusal(ctx, "not_submittable", "Only a draft quotation can be submitted for approval.", 409, [q.id]);
  if (q.approvalState === "approved") return refusal(ctx, "already_approved", "This quotation is already approved.", 409, [q.id]);

  // What the approver is shown must be what is saved: re-check the numbers before asking.
  const lines = parseStoredLines(q.lineItems);
  const subtotal = Number(q.subtotal.toString());
  const gst = Number(q.gstAmount.toString());
  const total = Number(q.grandTotal.toString());
  if (!totalsMatchLines({ lines, subtotal, gstAmount: gst, grandTotal: total })) {
    return refusal(ctx, "quote_inconsistent", "The saved totals do not match the saved lines. Ask a person to look at this quotation.", 409, [q.id]);
  }
  assertPriceable(lines);

  const contentHash = contentHashOf(q);
  const { approvalId } = await requestApproval({
    identityId: ctx.identityId,
    correlationId: ctx.correlationId,
    toolName: APPROVE_QUOTE_TOOL,
    // Everything the approver needs to judge the quotation, plus the hash that ties the approval to this exact content.
    input: {
      quotationId: q.id,
      quoteNumber: q.number,
      customerName: q.customerName,
      sport: q.sport,
      lengthFt: q.lengthFt,
      widthFt: q.widthFt,
      lines: lines
        .filter((l) => l.included)
        .map((l) => ({
          name: l.name,
          quantity: round2(l.areaSqFt),
          unit: l.unit ?? "sq.ft",
          ratePerUnit: l.ratePerSqFt,
          gstPercent: l.gstPercent,
        })),
      subtotal,
      gst,
      total,
      notes: q.notes,
      validityDays: q.validityDays,
      contentHash,
    },
  });

  if (q.approvalState !== "pending") {
    const moved = await prisma.quotation.updateMany({
      where: { id: q.id, agentOrigin: true, status: "draft", approvalState: { in: ["none", "rejected"] } },
      data: { approvalState: "pending", approvedByUserId: null, approvedAt: null },
    });
    if (moved.count !== 1) {
      return refusal(ctx, "not_submittable", "The quotation changed while it was being submitted. Fetch it and try again.", 409, [q.id]);
    }
  }

  return {
    status: 202,
    body: { quotation: quoteDto({ ...q, approvalState: "pending" }), approvalId, status: "pending" as const },
    recordIds: [q.id, approvalId],
    fieldsChanged: ["approvalState"],
  };
};

// ---- approve_quote (executor) --------------------------------------------------------

/** Runs when a person approves the approve_quote request: the quotation becomes approved, by that person. */
export const approveQuoteExecutor: ApprovalExecutor = async ({ ctx, input, approvedByUserId }) => {
  const parsed = approveQuoteInputSchema.safeParse(input);
  if (!parsed.success) return failure(ctx, 400, "invalid_input", "The stored approval request is not valid.");
  const q = await prisma.quotation.findUnique({ where: { id: parsed.data.quotationId } });
  if (!q) return failure(ctx, 404, "not_found", "Quotation not found.");
  if (q.approvalState !== "pending") {
    return failure(ctx, 409, "quote_not_pending", "The quotation is no longer waiting for approval (it was changed, or already decided).");
  }
  if (contentHashOf(q) !== parsed.data.contentHash) {
    // Someone edited it after it was submitted: that approval no longer covers it.
    await prisma.quotation.updateMany({ where: { id: q.id, approvalState: "pending" }, data: { approvalState: "none" } });
    return failure(ctx, 409, "quote_changed", "The quotation was changed after it was submitted, so it was not approved. Submit it again.");
  }
  try {
    assertPriceable(parseStoredLines(q.lineItems));
  } catch (err) {
    if (err instanceof AgentHttpError) return failure(ctx, 422, "invalid_input", err.message);
    throw err;
  }
  const done = await prisma.quotation.updateMany({
    where: { id: q.id, approvalState: "pending" },
    data: { approvalState: "approved", approvedByUserId, approvedAt: new Date() },
  });
  if (done.count !== 1) return failure(ctx, 409, "quote_not_pending", "The quotation is no longer waiting for approval.");
  return {
    status: 200,
    body: { quotationId: q.id, number: q.number, approvalState: "approved" },
    recordIds: { quotationId: q.id },
  };
};

// ---- request_discount ---------------------------------------------------------------

/**
 * Never runs for the AI: request_discount is an APPROVAL tool, so withAgent queues
 * the request before any handler runs. If it were ever reached, it refuses.
 */
export const requestDiscountHandler: AgentHandler<unknown> = async () => {
  throw new AgentHttpError("forbidden", "A discount is only applied after a person approves the request.");
};

/**
 * Runs when a person approves a discount request. A NEW revision (parent = the
 * quotation asked about) gets exactly the approved rates on the lines named in
 * the request; every other line keeps the rate it had. The revision is marked
 * approved by the person who approved the request. The original is untouched.
 */
export const requestDiscountExecutor: ApprovalExecutor = async ({ ctx, input, approvedByUserId }) => {
  const parsed = requestDiscountInputSchema.safeParse(input);
  if (!parsed.success) return failure(ctx, 400, "invalid_input", "The stored discount request is not valid.");
  const req = parsed.data;
  const orig = await prisma.quotation.findUnique({ where: { id: req.quotationId } });
  if (!orig) return failure(ctx, 404, "not_found", "Quotation not found.");
  if (!["draft", "sent", "viewed"].includes(orig.status)) {
    return failure(ctx, 409, "not_discountable", `A ${orig.status} quotation cannot be discounted. Ask for a new quotation instead.`);
  }

  const spec: DiscountSpec = req.lines ? { lines: req.lines } : { percent: req.percent as number };
  let applied;
  try {
    applied = applyDiscount(parseStoredLines(orig.lineItems), spec);
  } catch (err) {
    if (err instanceof DiscountError) return failure(ctx, 422, "invalid_discount", err.message);
    throw err;
  }

  // A repeat of the same approved discount (the runner retrying) returns the revision it already made.
  const hash = quoteContentHash({
    sport: orig.sport,
    lengthFt: orig.lengthFt,
    widthFt: orig.widthFt,
    lines: applied.lines,
    notes: orig.notes,
    validityDays: orig.validityDays,
  });
  const existing = await prisma.quotation.findMany({
    where: { parentQuotationId: orig.id, agentOrigin: true, approvalState: "approved", approvedByUserId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const twin = existing.find((q) => contentHashOf(q) === hash);
  if (twin) {
    return { status: 200, body: { quotation: quoteDto(twin), changes: applied.changes, deduplicated: true }, recordIds: { quotationId: twin.id, parentQuotationId: orig.id } };
  }

  if (orig.dealId) await demotePrimaryQuotes(orig.dealId);
  const now = new Date();
  const year = now.getFullYear();
  const revision = await createQuotationWithNumber({
    year,
    nextSeq: await nextSequenceForYear(year),
    data: {
      customerName: orig.customerName,
      sport: orig.sport,
      lengthFt: orig.lengthFt,
      widthFt: orig.widthFt,
      lineItems: JSON.stringify(applied.lines),
      subtotal: applied.totals.subtotal,
      gstAmount: applied.totals.gstAmount,
      grandTotal: applied.totals.grandTotal,
      notes: orig.notes,
      caption: null,
      quoteDate: now,
      validityDays: orig.validityDays,
      conversationId: orig.conversationId,
      contactPhone: orig.contactPhone,
      salespersonPhone: orig.salespersonPhone,
      sections: orig.sections,
      createdByUserId: ctx.userId,
      status: "draft",
      dealId: orig.dealId,
      accountContactId: orig.accountContactId,
      isPrimary: true,
      version: orig.version + 1,
      parentQuotationId: orig.id,
      // The person who approved the discount request is the approver of this revision.
      approvalState: "approved",
      approvedByUserId,
      approvedAt: now,
      agentOrigin: true,
    },
  });
  if (!revision) return failure(ctx, 503, "internal", "Could not assign a unique quote number. Try again in a moment.");

  if (revision.dealId) {
    await syncConversationDealValue(await setDealQuotedValue({ dealId: revision.dealId, quotedValue: applied.totals.grandTotal }));
    await writeDealLineItems({ dealId: revision.dealId, quotationId: revision.id, sport: revision.sport, lineItems: applied.lines });
  }
  return {
    status: 200,
    body: { quotation: quoteDto(revision), changes: applied.changes, reason: req.reason, deduplicated: false },
    recordIds: { quotationId: revision.id, parentQuotationId: orig.id },
  };
};
