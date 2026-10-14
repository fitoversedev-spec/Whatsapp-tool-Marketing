import type { Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { digitsOnly } from "../read/shared";
import { AgentHttpError } from "../errors";
import { isUuid } from "../schemas/read";
import {
  noticeFor,
  parseStoredLines,
  quoteStage,
  round2,
  type ApprovalState,
} from "./logic";

/** Loading, checking and shaping quotations for the agent. */

export const APPROVE_QUOTE_TOOL = "approve_quote";

/** A path id that is not a well-formed id can never match a row: answer 404, never ask the database. */
export function requireQuoteId(id: string | undefined): string {
  if (!id || !isUuid(id)) throw new AgentHttpError("not_found", "Quotation not found.");
  return id;
}

export async function loadQuote(id: string): Promise<Quotation> {
  const q = await prisma.quotation.findUnique({ where: { id } });
  if (!q) throw new AgentHttpError("not_found", "Quotation not found.");
  return reconcilePendingApproval(q);
}

/**
 * A quote marked "pending" is waiting on a row in the approvals list. If that
 * request was rejected, has run out its 24 hours, or is missing, the quote must
 * not stay "pending" forever: rejected -> "rejected", expired/missing -> "none"
 * (so the AI can submit it again). Returns the quote with its corrected state.
 */
export async function reconcilePendingApproval(q: Quotation): Promise<Quotation> {
  if (q.approvalState !== "pending") return q;
  const request = await prisma.agentApprovalRequest.findFirst({
    where: { toolName: APPROVE_QUOTE_TOOL, inputJson: { path: ["quotationId"], equals: q.id } },
    orderBy: { requestedAt: "desc" },
    select: { status: true, expiresAt: true },
  });
  let next: ApprovalState | null = null;
  if (!request) next = "none";
  else if (request.status === "rejected") next = "rejected";
  else if (["expired", "cancelled", "failed"].includes(request.status)) next = "none";
  else if (request.status === "pending" && request.expiresAt.getTime() <= Date.now()) next = "none";
  if (!next) return q;
  const changed = await prisma.quotation.updateMany({
    where: { id: q.id, approvalState: "pending" },
    data: { approvalState: next },
  });
  return changed.count === 1 ? { ...q, approvalState: next } : q;
}

const num = (v: { toString(): string } | number | null | undefined): number => (v == null ? 0 : Number(v.toString()));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function phoneLast4(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = digitsOnly(phone);
  return d.length >= 4 ? d.slice(-4) : null;
}

export function quoteLinesDto(q: Pick<Quotation, "lineItems">) {
  return parseStoredLines(q.lineItems).map((l) => {
    const amount = l.areaSqFt * l.ratePerSqFt;
    return {
      rateItemId: l.id,
      name: l.name,
      unit: l.unit ?? "sq.ft",
      quantity: round2(l.areaSqFt),
      ratePerUnit: l.ratePerSqFt,
      gstPercent: l.gstPercent,
      amount: round2(amount),
      gstAmount: round2((amount * l.gstPercent) / 100),
      included: !!l.included,
    };
  });
}

/** Columns the list and history views need; leaves out the line-item JSON. */
export const QUOTE_SUMMARY_SELECT = {
  id: true,
  number: true,
  version: true,
  status: true,
  approvalState: true,
  approvedAt: true,
  approvedByUserId: true,
  customerName: true,
  sport: true,
  lengthFt: true,
  widthFt: true,
  grandTotal: true,
  agentOrigin: true,
  parentQuotationId: true,
  accountContactId: true,
  conversationId: true,
  createdAt: true,
  sentAt: true,
} as const;

export type QuoteSummarySource = Pick<Quotation, keyof typeof QUOTE_SUMMARY_SELECT>;

export function quoteSummaryDto(q: QuoteSummarySource) {
  const stage = quoteStage(q);
  return {
    id: q.id,
    number: q.number,
    stage,
    status: q.status,
    approvalState: q.approvalState,
    approved: q.approvalState === "approved",
    customerName: q.customerName,
    sport: q.sport,
    lengthFt: q.lengthFt,
    widthFt: q.widthFt,
    total: num(q.grandTotal),
    createdByAgent: q.agentOrigin,
    parentQuotationId: q.parentQuotationId,
    leadId: q.accountContactId,
    conversationId: q.conversationId,
    createdAt: q.createdAt.toISOString(),
    sentAt: iso(q.sentAt),
  };
}

export function quoteDto(q: Quotation, warnings: string[] = []) {
  const validUntil = new Date(q.quoteDate.getTime() + q.validityDays * 24 * 60 * 60 * 1000);
  return {
    ...quoteSummaryDto(q),
    kind: "quotation" as const,
    version: q.version,
    notice: noticeFor(q),
    dealId: q.dealId,
    phoneLast4: phoneLast4(q.contactPhone),
    currency: "INR" as const,
    plotAreaSqFt: round2(q.lengthFt * q.widthFt),
    lines: quoteLinesDto(q),
    subtotal: num(q.subtotal),
    gst: num(q.gstAmount),
    notes: q.notes,
    validityDays: q.validityDays,
    quoteDate: q.quoteDate.toISOString(),
    validUntil: validUntil.toISOString(),
    approvedAt: iso(q.approvedAt),
    approvedByUserId: q.approvedByUserId,
    warnings,
  };
}
