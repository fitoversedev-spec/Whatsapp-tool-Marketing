import type { Prisma, Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { resolveContactForDocument } from "@/lib/crm/contactLinks";
import { getRatesForSport, SUPPORTED_SPORTS, type RateSheetItem, type Sport } from "@/lib/quotation/rates";
import {
  createQuotationWithNumber,
  demotePrimaryQuotes,
  nextSequenceForYear,
  setDealQuotedValue,
  syncConversationDealValue,
  writeDealLineItems,
} from "@/lib/quotation/service";
import { AgentHttpError } from "../errors";
import { refusal } from "../messaging/access";
import type { AgentHandler } from "../withAgent";
import type { CreateDraftQuoteInput, QuotePathInput, UpdateDraftQuoteInput } from "../schemas/quotes";
import { DEFAULT_VALIDITY_DAYS } from "../schemas/quotes";
import {
  buildQuoteLines,
  DEDUPE_WINDOW_MS,
  droppedLineWarnings,
  parseStoredLines,
  quoteContentHash,
  resolveItemSettings,
  settingsFromLines,
  type BuiltQuote,
} from "./logic";
import { loadQuote, quoteDto } from "./store";

/**
 * create_draft_quote, update_draft_quote and revise_quote.
 *
 * Whatever the caller sends, the lines come from the rate sheet: rates and GST
 * from getRatesForSport, quantities from the plot (or the caller's piece
 * counts), totals from recompute(). A quote made here is a DRAFT
 * (agentOrigin = true, approvalState = "none"); it cannot be sent until a person
 * approves it.
 */

const AGENT_ROLE = "ai_agent";

async function sheetFor(sport: string): Promise<RateSheetItem[]> {
  if (!(SUPPORTED_SPORTS as string[]).includes(sport)) {
    throw new AgentHttpError("invalid_input", `Quotations for "${sport}" are not supported by the AI agent.`, 422);
  }
  return getRatesForSport(sport as Sport);
}

// ---- who the quote is for -----------------------------------------------------

type Target = {
  accountContactId: string | null;
  accountId: string | null;
  conversationId: string | null;
  customerName: string;
  contactPhone: string | null;
};

const CONTACT_SELECT = {
  id: true,
  name: true,
  phone: true,
  accountId: true,
  deletedAt: true,
  account: { select: { deletedAt: true } },
} as const;

async function loadContact(id: string) {
  const c = await prisma.accountContact.findUnique({ where: { id }, select: CONTACT_SELECT });
  return !c || c.deletedAt || c.account.deletedAt ? null : c;
}

/** The customer for a new quote: the lead named, the CRM contact behind the conversation, or just the chat. */
async function resolveTarget(userId: string, input: Pick<CreateDraftQuoteInput, "leadId" | "conversationId">): Promise<Target> {
  let contact = null as Awaited<ReturnType<typeof loadContact>>;
  if (input.leadId) {
    contact = await loadContact(input.leadId);
    if (!contact) throw new AgentHttpError("not_found", "Lead not found.");
  }
  let convo: { id: string; contactPhone: string; contactName: string | null } | null = null;
  if (input.conversationId) {
    convo = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, contactPhone: true, contactName: true },
    });
    if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");
  }
  if (contact?.phone && convo && normalizePhone(contact.phone) !== convo.contactPhone) {
    throw new AgentHttpError("invalid_input", "leadId and conversationId belong to different phone numbers.", 409);
  }
  if (!contact && convo) {
    // Same lookup the human quote wizard uses (chat -> the contact it was moved to CRM as, or the one contact with that phone).
    const resolved = await resolveContactForDocument({ conversationId: convo.id }, { id: userId, role: AGENT_ROLE });
    if (resolved) contact = await loadContact(resolved.id);
  }
  const contactPhone = convo?.contactPhone ?? contact?.phone ?? null;
  const customerName = (contact?.name || convo?.contactName || contactPhone || "Customer").trim().slice(0, 200) || "Customer";
  return {
    accountContactId: contact?.id ?? null,
    accountId: contact?.accountId ?? null,
    conversationId: convo?.id ?? null,
    customerName,
    contactPhone,
  };
}

// ---- dedupe ---------------------------------------------------------------------

function hashOf(q: Pick<Quotation, "sport" | "lengthFt" | "widthFt" | "lineItems" | "notes" | "validityDays">): string {
  return quoteContentHash({
    sport: q.sport,
    lengthFt: q.lengthFt,
    widthFt: q.widthFt,
    lines: parseStoredLines(q.lineItems),
    notes: q.notes,
    validityDays: q.validityDays,
  });
}

/** A draft the AI made for the same customer, with exactly this content, in the last 10 minutes. */
async function findRecentTwin(where: Prisma.QuotationWhereInput, hash: string, now: number): Promise<Quotation | null> {
  const recent = await prisma.quotation.findMany({
    where: { agentOrigin: true, status: "draft", createdAt: { gte: new Date(now - DEDUPE_WINDOW_MS) }, ...where },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return recent.find((q) => hashOf(q) === hash) ?? null;
}

// ---- deal bookkeeping (same steps as the human create) ------------------------------

async function attachToDeal(args: { quotation: Quotation; built: BuiltQuote }): Promise<void> {
  const { quotation, built } = args;
  if (!quotation.dealId) return;
  const deal = await setDealQuotedValue({ dealId: quotation.dealId, quotedValue: built.totals.grandTotal });
  await syncConversationDealValue(deal);
  await writeDealLineItems({
    dealId: quotation.dealId,
    quotationId: quotation.id,
    sport: quotation.sport,
    lineItems: built.lines,
  });
}

async function createQuoteRow(data: Omit<Prisma.QuotationUncheckedCreateInput, "number">): Promise<Quotation> {
  const now = new Date();
  const year = now.getFullYear();
  const nextSeq = await nextSequenceForYear(year);
  const quotation = await createQuotationWithNumber({ year, nextSeq, data });
  if (!quotation) throw new AgentHttpError("internal", "Could not assign a unique quote number. Try again in a moment.", 503);
  return quotation;
}

// ---- create_draft_quote ----------------------------------------------------------

export const createDraftQuote: AgentHandler<CreateDraftQuoteInput> = async ({ ctx, input }) => {
  const target = await resolveTarget(ctx.userId, input);
  const sheet = await sheetFor(input.sport);
  const { settings, named } = resolveItemSettings({ sheet, patches: input.items });
  const built = buildQuoteLines({ sheet, lengthFt: input.lengthFt, widthFt: input.widthFt, settings, named });
  const validityDays = input.validityDays ?? DEFAULT_VALIDITY_DAYS;
  const hash = quoteContentHash({
    sport: input.sport,
    lengthFt: input.lengthFt,
    widthFt: input.widthFt,
    lines: built.lines,
    notes: input.notes,
    validityDays,
  });

  // The same draft asked for twice in a row (a retry that lost its Idempotency-Key) is one draft.
  const sameCustomer: Prisma.QuotationWhereInput[] = [];
  if (target.accountContactId) sameCustomer.push({ accountContactId: target.accountContactId });
  if (target.conversationId) sameCustomer.push({ conversationId: target.conversationId });
  const twin = sameCustomer.length ? await findRecentTwin({ OR: sameCustomer }, hash, Date.now()) : null;
  if (twin) {
    return {
      body: {
        quotation: quoteDto(twin, ["An identical draft was created in the last 10 minutes; it is returned instead of a new one."]),
        deduplicated: true,
      },
      recordIds: [twin.id],
    };
  }

  let dealId: string | null = null;
  if (input.dealId) {
    const deal = await prisma.deal.findUnique({ where: { id: input.dealId }, select: { id: true, accountId: true, deletedAt: true } });
    if (!deal || deal.deletedAt) throw new AgentHttpError("not_found", "Deal not found.");
    if (target.accountId && deal.accountId !== target.accountId) {
      throw new AgentHttpError("invalid_input", "That deal belongs to a different customer.", 409);
    }
    dealId = deal.id;
  }

  const warnings = [...built.warnings];
  if (!target.contactPhone) warnings.push("The customer has no phone number on file, so this quotation cannot be sent until one is added.");

  if (dealId) {
    // A new quote on a deal becomes its primary one (same as the human flow).
    await demotePrimaryQuotes(dealId);
  }
  const quotation = await createQuoteRow({
    customerName: target.customerName,
    sport: input.sport,
    lengthFt: input.lengthFt,
    widthFt: input.widthFt,
    lineItems: JSON.stringify(built.lines),
    subtotal: built.totals.subtotal,
    gstAmount: built.totals.gstAmount,
    grandTotal: built.totals.grandTotal,
    notes: input.notes ?? null,
    caption: null,
    quoteDate: new Date(),
    validityDays,
    conversationId: target.conversationId,
    contactPhone: target.contactPhone,
    salespersonPhone: null,
    sections: null,
    createdByUserId: ctx.userId,
    status: "draft",
    dealId,
    accountContactId: target.accountContactId,
    isPrimary: true,
    approvalState: "none",
    agentOrigin: true,
  });
  await attachToDeal({ quotation, built });

  return {
    body: { quotation: quoteDto(quotation, warnings), deduplicated: false },
    recordIds: [quotation.id],
    fieldsChanged: ["quotation"],
  };
};

// ---- update_draft_quote ----------------------------------------------------------

/** Why this quote cannot be edited by the AI, or null when it can. */
export function whyNotEditable(q: Pick<Quotation, "agentOrigin" | "status" | "approvalState">): string | null {
  if (!q.agentOrigin) return "The AI agent can only change drafts it created itself.";
  if (q.status !== "draft") return "Only a draft can be changed. Use revise_quote to start a new draft from this quotation.";
  if (q.approvalState === "pending") return "This quotation is waiting for approval and is locked. A person must approve or reject it first.";
  if (q.approvalState === "approved") return "This quotation is approved and locked. Use revise_quote to start a new draft from it.";
  return null;
}

export const updateDraftQuote: AgentHandler<UpdateDraftQuoteInput> = async ({ ctx, input }) => {
  const q = await loadQuote(input.quotationId);
  const why = whyNotEditable(q);
  if (why) return refusal(ctx, "not_editable", why, 409, [q.id]);

  const sheet = await sheetFor(q.sport);
  const oldLines = parseStoredLines(q.lineItems);
  // Re-price the WHOLE quote from the current sheet; the caller only moves quantities and in/out flags.
  const { settings, named } = resolveItemSettings({
    sheet,
    patches: input.items,
    base: settingsFromLines(oldLines, sheet),
  });
  const built = buildQuoteLines({ sheet, lengthFt: q.lengthFt, widthFt: q.widthFt, settings, named });
  const warnings = [...droppedLineWarnings(oldLines, sheet), ...built.warnings];
  const oldTotal = Number(q.grandTotal.toString());
  if (Math.abs(oldTotal - built.totals.grandTotal) >= 0.01 && !input.items) {
    warnings.push(`Prices were refreshed from the current rate sheet: the total changed from ${oldTotal} to ${built.totals.grandTotal}.`);
  }

  const notes = input.notes === undefined ? q.notes : input.notes;
  const validityDays = input.validityDays ?? q.validityDays;
  const changed = await prisma.quotation.updateMany({
    // Guard on the state we checked so a concurrent submit or edit cannot be overwritten.
    where: { id: q.id, agentOrigin: true, status: "draft", approvalState: { in: ["none", "rejected"] } },
    data: {
      lineItems: JSON.stringify(built.lines),
      subtotal: built.totals.subtotal,
      gstAmount: built.totals.gstAmount,
      grandTotal: built.totals.grandTotal,
      notes,
      validityDays,
      pdfUrl: null,
      approvalState: "none",
      approvedByUserId: null,
      approvedAt: null,
    },
  });
  if (changed.count !== 1) return refusal(ctx, "not_editable", "The quotation changed while it was being updated. Fetch it and try again.", 409, [q.id]);

  const updated = (await prisma.quotation.findUnique({ where: { id: q.id } })) ?? q;
  if (updated.dealId) {
    if (updated.isPrimary) await syncConversationDealValue(await setDealQuotedValue({ dealId: updated.dealId, quotedValue: built.totals.grandTotal }));
    await writeDealLineItems({
      dealId: updated.dealId,
      quotationId: updated.id,
      sport: updated.sport,
      lineItems: built.lines,
      replaceExisting: true,
    });
  }
  return {
    body: { quotation: quoteDto(updated, warnings) },
    recordIds: [q.id],
    fieldsChanged: [
      ...(input.items ? ["items"] : []),
      ...(input.notes !== undefined ? ["notes"] : []),
      ...(input.validityDays !== undefined ? ["validityDays"] : []),
      "totals",
    ],
  };
};

// ---- revise_quote ----------------------------------------------------------------

export const reviseQuote: AgentHandler<QuotePathInput> = async ({ ctx, input }) => {
  const old = await loadQuote(input.quotationId);
  const sheet = await sheetFor(old.sport);
  const oldLines = parseStoredLines(old.lineItems);
  // The same scope (lines in/out, piece counts), priced from the CURRENT sheet.
  const { settings, named } = resolveItemSettings({ sheet, patches: undefined, base: settingsFromLines(oldLines, sheet) });
  const built = buildQuoteLines({ sheet, lengthFt: old.lengthFt, widthFt: old.widthFt, settings, named });
  const warnings = [...droppedLineWarnings(oldLines, sheet), ...built.warnings];

  // A revision asked for twice (a retry) is one revision.
  const hash = quoteContentHash({
    sport: old.sport,
    lengthFt: old.lengthFt,
    widthFt: old.widthFt,
    lines: built.lines,
    notes: old.notes,
    validityDays: old.validityDays,
  });
  const twin = await findRecentTwin({ parentQuotationId: old.id }, hash, Date.now());
  if (twin) {
    return {
      body: { quotation: quoteDto(twin, ["An identical revision was created in the last 10 minutes; it is returned instead of a new one."]) },
      recordIds: [old.id, twin.id],
    };
  }

  const oldTotal = Number(old.grandTotal.toString());
  if (Math.abs(oldTotal - built.totals.grandTotal) >= 0.01) {
    warnings.push(`Priced from the current rate sheet: the total is ${built.totals.grandTotal} (the previous quotation was ${oldTotal}).`);
  }

  if (old.dealId) await demotePrimaryQuotes(old.dealId);
  const quotation = await createQuoteRow({
    customerName: old.customerName,
    sport: old.sport,
    lengthFt: old.lengthFt,
    widthFt: old.widthFt,
    lineItems: JSON.stringify(built.lines),
    subtotal: built.totals.subtotal,
    gstAmount: built.totals.gstAmount,
    grandTotal: built.totals.grandTotal,
    notes: old.notes,
    caption: null,
    quoteDate: new Date(),
    validityDays: old.validityDays,
    conversationId: old.conversationId,
    contactPhone: old.contactPhone,
    salespersonPhone: old.salespersonPhone,
    // The quote's terms and layout carry over untouched; the AI cannot edit them.
    sections: old.sections,
    createdByUserId: ctx.userId,
    status: "draft",
    dealId: old.dealId,
    accountContactId: old.accountContactId,
    isPrimary: true,
    version: old.version + 1,
    parentQuotationId: old.id,
    approvalState: "none",
    agentOrigin: true,
  });
  await attachToDeal({ quotation, built });

  return {
    body: { quotation: quoteDto(quotation, warnings) },
    recordIds: [old.id, quotation.id],
    fieldsChanged: ["quotation"],
  };
};
