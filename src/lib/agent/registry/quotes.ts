import type { ToolDefinition } from "../permissions";
import type { AgentRouteSpec } from "../openapi";
import type { ApprovalExecutor } from "../executors";
import { approveQuoteExecutor, requestDiscountExecutor } from "../quotes/approval";
import * as S from "../schemas/quotes";

// Stage 4: quotation tools. Three kinds of thing are kept apart on purpose:
//   estimate  (stage 1, estimate_price) nothing saved; indicative only
//   draft     create_draft_quote / update_draft_quote / revise_quote: the AI's proposal
//   approved  a person signed it off; the ONLY state send_quote will send
// The AI never supplies a rate. Rates and GST come from the rate sheet, totals from
// the shared calculator, and any discount waits for a person (request_discount).
const allowed = (action: ToolDefinition["action"]): ToolDefinition => ({ default: "ALLOWED", action });
const needsApproval = (action: ToolDefinition["action"]): ToolDefinition => ({ default: "APPROVAL", action, neverLoosen: true });
const never = (action: ToolDefinition["action"]): ToolDefinition => ({ default: "NEVER", action, neverLoosen: true });

export const TOOLS: Record<string, ToolDefinition> = {
  create_draft_quote: allowed("create"),
  get_quote: allowed("read"),
  list_quotes: allowed("read"),
  update_draft_quote: allowed("update"),
  revise_quote: allowed("create"),
  get_quote_pdf: allowed("read"),
  quote_history: allowed("read"),
  submit_quote_for_approval: allowed("update"),
  request_discount: needsApproval("create"),
  send_quote: allowed("send"),
  list_quote_templates: allowed("read"),
  list_invoices: allowed("read"),
  get_invoice: allowed("read"),
  // Only a person approves a quotation. The tool exists so the approvals list has a name for
  // the request and an executor to run; the AI itself can never call it (no route).
  approve_quote: never("update"),
  // Terms, invoices, payments and rates are never the AI's to touch (no routes).
  edit_quote_terms: never("update"),
  convert_to_invoice: never("create"),
  record_payment: never("create"),
  set_rate: never("update"),
};

/** Run by the approvals runner when a person approves the matching request. */
export const EXECUTORS: Record<string, ApprovalExecutor> = {
  approve_quote: approveQuoteExecutor,
  request_discount: requestDiscountExecutor,
};

// GET routes take their input as query-string parameters, listed in each summary. POST/PATCH
// routes carry a JSON body. {id} is the quotation (or, for /invoices, the invoice). Quote
// responses carry stage / approvalState / approved / notice: only approved === true means a
// person has signed the quotation off. Refusals have a stable `error.code` (quote_not_approved,
// handoff_required, opted_out, recently_sent, not_editable, ...).
export const ROUTES: AgentRouteSpec[] = [
  {
    path: "/quotations",
    method: "post",
    tool: "create_draft_quote",
    summary:
      "Create a DRAFT quotation for a lead (or conversation) from the rate sheet. You choose the sport, plot size and which items are in; rates, GST and totals always come from the rate sheet, and sending a rate or price is a 400. Optional items that are priced per piece need a quantity. The draft cannot be sent until a person approves it (submit_quote_for_approval). The same draft asked for again within 10 minutes is returned (deduplicated:true).",
    requestSchema: S.createDraftQuoteBodySchema,
    responseSchema: S.createDraftQuoteResponseSchema,
  },
  {
    path: "/quotations",
    method: "get",
    tool: "list_quotes",
    summary:
      "List quotations. Query: leadId, conversationId, status (draft|sent|viewed|accepted|expired|rejected|superseded), approvalState (none|pending|approved|rejected), limit (1-100, default 20), cursor. With neither leadId nor conversationId it lists only the quotations the AI created.",
    responseSchema: S.listQuotesResponseSchema,
  },
  {
    path: "/quotations/templates",
    method: "get",
    tool: "list_quote_templates",
    summary: "The standard quotation layout for a sport (cover, notes, payment schedule, terms). Read-only: the AI cannot edit terms. Query: sport.",
    responseSchema: S.quoteTemplatesResponseSchema,
  },
  {
    path: "/quotations/{id}",
    method: "get",
    tool: "get_quote",
    summary: "One quotation: lines (rate sheet rates), totals, stage and approval state. A quotation is a draft until approved is true.",
    responseSchema: S.quoteResponseSchema,
  },
  {
    path: "/quotations/{id}",
    method: "patch",
    tool: "update_draft_quote",
    summary:
      "Change a draft the AI created: item quantities and in/out flags, notes, validity. The whole quotation is re-priced from the current rate sheet; there is no way to set a rate. Returns 409 not_editable once it is pending approval, approved or sent (use revise_quote).",
    requestSchema: S.updateDraftQuoteBodySchema,
    responseSchema: S.quoteResponseSchema,
  },
  {
    path: "/quotations/{id}/revise",
    method: "post",
    tool: "revise_quote",
    summary:
      "Start a new draft from an existing quotation: same scope, re-priced from the CURRENT rate sheet, new number, linked to the old one (which stays as history). The new draft needs its own approval.",
    requestSchema: S.reviseQuoteBodySchema,
    responseSchema: S.quoteResponseSchema,
  },
  {
    path: "/quotations/{id}/pdf",
    method: "get",
    tool: "get_quote_pdf",
    summary:
      "The saved PDF of a quotation. pdfUrl is an internal staff-only link: never give it to a customer. customerUrl is present only once the quotation is approved.",
    responseSchema: S.quotePdfResponseSchema,
  },
  {
    path: "/quotations/{id}/history",
    method: "get",
    tool: "quote_history",
    summary: "The chain of versions this quotation belongs to (revisions, approved discounts), with each version's approval state, approver and total.",
    responseSchema: S.quoteHistoryResponseSchema,
  },
  {
    path: "/quotations/{id}/submit",
    method: "post",
    tool: "submit_quote_for_approval",
    summary:
      "Ask a person to approve a draft the AI created. The draft is locked (approvalState pending) and an approval request is queued (202). Only an approved quotation can be sent.",
    requestSchema: S.submitQuoteBodySchema,
    responseSchema: S.submitQuoteResponseSchema,
  },
  {
    path: "/quotations/{id}/discount-requests",
    method: "post",
    tool: "request_discount",
    summary:
      "Ask for a discount: either specific lower rates on specific lines (lines) or a percentage (percent, at most 50), plus a reason. Waits for human approval (202). If approved, a NEW approved revision is created with only those rates changed; the original stays as it was. The AI can never change a price any other way.",
    requestSchema: S.requestDiscountBodySchema,
    responseSchema: S.discountResponseSchema,
  },
  {
    path: "/quotations/{id}/send",
    method: "post",
    tool: "send_quote",
    summary:
      "Send an APPROVED quotation to the customer on WhatsApp. 403 quote_not_approved if no person approved it; 409 handoff_required (nothing sent) if the customer's 24-hour window is closed; 403 opted_out; 409 recently_sent within 10 minutes of an earlier send. The recipient and text cannot be chosen.",
    requestSchema: S.sendQuoteBodySchema,
    responseSchema: S.sendQuoteResponseSchema,
  },
  {
    path: "/invoices",
    method: "get",
    tool: "list_invoices",
    summary: "List invoices (read-only). Query: leadId or quotationId (one is required), status, limit (1-100, default 20), cursor.",
    responseSchema: S.listInvoicesResponseSchema,
  },
  {
    path: "/invoices/{id}",
    method: "get",
    tool: "get_invoice",
    summary: "One invoice (read-only): lines, totals, amount paid, balance and payment dates. The AI cannot create invoices or record payments.",
    responseSchema: S.invoiceResponseSchema,
  },
];
