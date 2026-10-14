import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureQuotationPdf } from "@/lib/quotation/pdf-cache";
import { buildDefaultSections } from "@/lib/quotation/section-types";
import { AgentHttpError } from "../errors";
import { isUuid } from "../schemas/read";
import { requireId } from "../read/shared";
import type { AgentHandler } from "../withAgent";
import type { ListInvoicesInput, ListQuotesInput, listQuoteTemplatesQuerySchema } from "../schemas/quotes";
import type { z } from "zod/v4";
import { noticeFor, quoteStage, round2 } from "./logic";
import {
  loadQuote,
  phoneLast4,
  quoteDto,
  quoteLinesDto,
  quoteSummaryDto,
  QUOTE_SUMMARY_SELECT,
  requireQuoteId,
  type QuoteSummarySource,
} from "./store";

/** The read-only quote and invoice tools: get_quote, list_quotes, get_quote_pdf, quote_history, list_quote_templates, list_invoices, get_invoice. */

const APP_URL = process.env.APP_URL ?? "https://whatsapp-tool-marketing.vercel.app";
const num = (v: { toString(): string } | number | null | undefined): number => (v == null ? 0 : Number(v.toString()));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ---- get_quote -----------------------------------------------------------------

export const getQuote: AgentHandler<unknown> = async ({ params }) => {
  const q = await loadQuote(requireQuoteId(params.id));
  return { body: { quotation: quoteDto(q) }, recordIds: [q.id] };
};

// ---- list_quotes ----------------------------------------------------------------

export const listQuotes: AgentHandler<ListQuotesInput> = async ({ input }) => {
  const where: Prisma.QuotationWhereInput = {};
  if (input.leadId) where.accountContactId = input.leadId;
  if (input.conversationId) where.conversationId = input.conversationId;
  // Without a customer to look at, the list is only the quotations the AI made itself.
  if (!input.leadId && !input.conversationId) where.agentOrigin = true;
  if (input.status) where.status = input.status;
  if (input.approvalState) where.approvalState = input.approvalState;
  if (input.cursor && !isUuid(input.cursor))
    throw new AgentHttpError("invalid_input", "Unknown cursor. Start again without one.");

  const rows = await prisma.quotation.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: QUOTE_SUMMARY_SELECT,
  });
  const page = rows.slice(0, input.limit);
  return {
    body: {
      items: page.map(quoteSummaryDto),
      nextCursor: rows.length > input.limit && page.length ? page[page.length - 1].id : null,
    },
    recordIds: page.map((r) => r.id),
  };
};

// ---- get_quote_pdf ---------------------------------------------------------------

export const getQuotePdf: AgentHandler<unknown> = async ({ params }) => {
  const q = await loadQuote(requireQuoteId(params.id));
  let url: string;
  try {
    url = (await ensureQuotationPdf(q)).url;
  } catch (err) {
    console.error("[agent] quote pdf failed", { error: (err as Error)?.name });
    throw new AgentHttpError("internal", "Could not render the quotation PDF.", 502);
  }
  const approved = q.approvalState === "approved";
  return {
    body: {
      quotationId: q.id,
      number: q.number,
      approvalState: q.approvalState,
      // The saved copy of the PDF. Internal: a draft must never reach a customer, and even an
      // approved quote goes to a customer only through send_quote.
      pdfUrl: url,
      staffOnly: true,
      // The customer-facing link exists only once a person approved the quote.
      customerUrl: approved ? `${APP_URL}/q/${q.id}` : null,
      notice: noticeFor(q),
    },
    recordIds: [q.id],
  };
};

// ---- quote_history ----------------------------------------------------------------

const MAX_HOPS = 25;
const MAX_CHAIN = 100;

export const quoteHistory: AgentHandler<unknown> = async ({ params }) => {
  const current = await loadQuote(requireQuoteId(params.id));
  const chain = new Map<string, QuoteSummarySource>();

  // Up to the first quote in the chain...
  let root: QuoteSummarySource = current;
  chain.set(current.id, current);
  for (let hop = 0; hop < MAX_HOPS && root.parentQuotationId && !chain.has(root.parentQuotationId); hop++) {
    const parent = await prisma.quotation.findUnique({
      where: { id: root.parentQuotationId },
      select: QUOTE_SUMMARY_SELECT,
    });
    if (!parent) break;
    chain.set(parent.id, parent);
    root = parent;
  }
  // ...then down through every revision made from it.
  let frontier = [root.id];
  const expanded = new Set<string>(frontier);
  for (let depth = 0; depth < MAX_HOPS && frontier.length && chain.size < MAX_CHAIN; depth++) {
    const kids = await prisma.quotation.findMany({
      where: { parentQuotationId: { in: frontier } },
      orderBy: { createdAt: "asc" },
      take: MAX_CHAIN,
      select: QUOTE_SUMMARY_SELECT,
    });
    frontier = [];
    for (const k of kids) {
      if (!chain.has(k.id)) chain.set(k.id, k);
      // Expand every revision once, including ones already seen on the way up.
      if (!expanded.has(k.id)) {
        expanded.add(k.id);
        frontier.push(k.id);
      }
    }
  }

  const rows = [...chain.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.version - b.version,
  );
  const approverIds = [...new Set(rows.map((r) => r.approvedByUserId).filter((v): v is string => !!v))];
  const approvers = approverIds.length
    ? await prisma.user.findMany({
        where: { id: { in: approverIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(approvers.map((u) => [u.id, u.name]));

  return {
    body: {
      quotationId: current.id,
      chain: rows.map((r) => {
        // The current quote's state was reconciled with the approvals list on load.
        const approvalState = r.id === current.id ? current.approvalState : r.approvalState;
        return {
          id: r.id,
          number: r.number,
          version: r.version,
          current: r.id === current.id,
          status: r.status,
          stage: quoteStage({ status: r.status, approvalState }),
          approvalState,
          approvedAt: iso(r.approvedAt),
          approvedBy: r.approvedByUserId
            ? {
                id: r.approvedByUserId,
                name: nameOf.get(r.approvedByUserId) ?? "Unknown",
              }
            : null,
          parentQuotationId: r.parentQuotationId,
          createdByAgent: r.agentOrigin,
          total: num(r.grandTotal),
          createdAt: r.createdAt.toISOString(),
          sentAt: iso(r.sentAt),
        };
      }),
    },
    recordIds: rows.map((r) => r.id),
  };
};

// ---- list_quote_templates ---------------------------------------------------------

/** The standard quotation layout for a sport (cover, terms, payment schedule...). Read-only: the AI cannot change terms. */
export const listQuoteTemplates: AgentHandler<z.infer<typeof listQuoteTemplatesQuerySchema>> = async ({ input }) => ({
  body: {
    sport: input.sport,
    kind: "template" as const,
    editableByAgent: false as const,
    sections: buildDefaultSections(input.sport),
  },
});

// ---- invoices (read-only) ----------------------------------------------------------

const INVOICE_SUMMARY_SELECT = {
  id: true,
  number: true,
  quotationId: true,
  customerName: true,
  sport: true,
  status: true,
  grandTotal: true,
  amountPaid: true,
  invoiceDate: true,
  dueDate: true,
  paidAt: true,
} as const;

type InvoiceSummarySource = Prisma.InvoiceGetPayload<{
  select: typeof INVOICE_SUMMARY_SELECT;
}>;

function invoiceSummary(i: InvoiceSummarySource) {
  const total = num(i.grandTotal);
  const paid = num(i.amountPaid);
  return {
    id: i.id,
    number: i.number,
    quotationId: i.quotationId,
    customerName: i.customerName,
    sport: i.sport,
    status: i.status,
    total,
    amountPaid: paid,
    balance: round2(Math.max(0, total - paid)),
    invoiceDate: i.invoiceDate.toISOString(),
    dueDate: i.dueDate.toISOString(),
    paidAt: iso(i.paidAt),
  };
}

export const listInvoices: AgentHandler<ListInvoicesInput> = async ({ input }) => {
  const where: Prisma.InvoiceWhereInput = {};
  if (input.quotationId) where.quotationId = input.quotationId;
  if (input.leadId) where.quotation = { accountContactId: input.leadId };
  if (input.status) where.status = input.status;
  if (input.cursor && !isUuid(input.cursor))
    throw new AgentHttpError("invalid_input", "Unknown cursor. Start again without one.");

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: INVOICE_SUMMARY_SELECT,
  });
  const page = rows.slice(0, input.limit);
  return {
    body: {
      items: page.map(invoiceSummary),
      nextCursor: rows.length > input.limit && page.length ? page[page.length - 1].id : null,
    },
    recordIds: page.map((r) => r.id),
  };
};

export const getInvoice: AgentHandler<unknown> = async ({ params }) => {
  const id = requireId(params.id, "Invoice");
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: {
      ...INVOICE_SUMMARY_SELECT,
      contactPhone: true,
      subtotal: true,
      gstAmount: true,
      lineItems: true,
      // Amounts, dates and method only; bank references and notes stay with staff.
      payments: {
        select: { amount: true, paidAt: true, method: true },
        orderBy: { paidAt: "asc" },
      },
    },
  });
  if (!inv) throw new AgentHttpError("not_found", "Invoice not found.");
  return {
    body: {
      invoice: {
        ...invoiceSummary(inv),
        phoneLast4: phoneLast4(inv.contactPhone),
        subtotal: num(inv.subtotal),
        gst: num(inv.gstAmount),
        lines: quoteLinesDto({ lineItems: inv.lineItems }),
        payments: inv.payments.map((p) => ({
          amount: num(p.amount),
          paidAt: p.paidAt.toISOString(),
          method: p.method,
        })),
      },
    },
    recordIds: [inv.id],
  };
};
