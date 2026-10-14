import { z } from "zod/v4";
import { SUPPORTED_SPORTS, type Sport } from "@/lib/quotation/rates";
import { detectSensitiveContent } from "../messaging/contentGuard";
import { MAX_DISCOUNT_PERCENT } from "../quotes/logic";
import { cursorParam, limitParam, nextCursorSchema } from "./read";

/**
 * Stage 4 (quotation tools): request and response shapes.
 *
 * Every request object is STRICT, so a key that is not listed is an error, never
 * silently dropped. That is how "the AI can never set a rate" is enforced at the
 * door: there is no field for a rate, a price, a total or a tax, and sending
 * `ratePerUnit`, `rate`, `price`, `total` or `gst` anywhere is a 400.
 *
 * Tools that act on one quote take its id from the URL path; the route copies it
 * into the body as `quotationId` first (see leads/pathIds.ts) so an approval
 * request keeps it. <tool>BodySchema is what the caller sends (published in the
 * OpenAPI document); <tool>InputSchema is what withAgent validates.
 */

export const MAX_DIMENSION_FT = 10_000;
export const MAX_PIECE_QUANTITY = 10_000;
export const MAX_ITEMS = 60;
export const MAX_VALIDITY_DAYS = 365;
export const DEFAULT_VALIDITY_DAYS = 30;
export const MAX_RATE = 1_000_000;

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "expired", "rejected", "superseded"] as const;
export const APPROVAL_STATES = ["none", "pending", "approved", "rejected"] as const;
export const QUOTE_STAGES = ["draft", "pending_approval", "approved", "sent", "accepted", "closed"] as const;
export const INVOICE_STATUSES = ["issued", "sent", "partially_paid", "paid", "overdue", "cancelled"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = () => z.string().uuid();
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalUuid = z.preprocess(blankToUndefined, z.string().trim().regex(UUID_RE, "must be an id").optional());

export const sportSchema = z.enum(SUPPORTED_SPORTS as [Sport, ...Sport[]]);
const dimension = z.number().int().min(1).max(MAX_DIMENSION_FT);
const validityDays = z.number().int().min(1).max(MAX_VALIDITY_DAYS);

/** Quote notes are printed on the customer's PDF: no prices, discounts or promises in free text. */
const quoteNotes = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .superRefine((v, ctx) => {
    const g = detectSensitiveContent(v);
    if (g.flagged) {
      ctx.addIssue({
        code: "custom",
        message: `Notes are printed on the customer's quotation and cannot mention prices, discounts or promises (found: ${g.matches.join(", ")}). Use request_discount to ask for a discount.`,
      });
    }
  });

/** One scope line. There is deliberately no rate, price, total or GST field: those come from the rate sheet. */
const itemSchema = z.strictObject({
  rateItemId: z.string().trim().min(1).max(80).describe("Id of an item on the sport's rate sheet (get_rate_sheet)."),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(MAX_PIECE_QUANTITY)
    .optional()
    .describe("Number of pieces. Per-piece items only; it is required when you include one."),
  included: z
    .boolean()
    .optional()
    .describe("false removes a default item; true (the default when you name an item) adds it."),
});

const itemsSchema = z
  .array(itemSchema)
  .max(MAX_ITEMS)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((it, i) => {
      if (seen.has(it.rateItemId)) {
        ctx.addIssue({ code: "custom", path: [i, "rateItemId"], message: "Each rate item may be listed only once." });
      }
      seen.add(it.rateItemId);
    });
  });

/** Builds the published body schema and the internal input schema from one shape. */
function build<S extends z.ZodRawShape>(shape: S) {
  return {
    body: z.strictObject(shape),
    input: z.strictObject({ quotationId: id(), ...shape } as { quotationId: z.ZodString } & S),
  };
}

const hasAny = (o: Record<string, unknown>) => Object.values(o).some((v) => v !== undefined);

// ── create_draft_quote ──────────────────────────────────────────────────────

const createShape = {
  leadId: id().optional().describe("The customer (a lead or contact id). Send this or conversationId."),
  conversationId: id().optional().describe("The customer's WhatsApp conversation. Send this or leadId."),
  dealId: id().optional().describe("Only to quote against an already-confirmed project."),
  sport: sportSchema,
  lengthFt: dimension,
  widthFt: dimension,
  items: itemsSchema
    .optional()
    .describe("Scope changes against the rate sheet's default scope. Omit for the default scope."),
  notes: quoteNotes.optional(),
  validityDays: validityDays.optional().describe(`Days the quotation stays valid (default ${DEFAULT_VALIDITY_DAYS}).`),
};
export const createDraftQuoteBodySchema = z.strictObject(createShape).refine((o) => !!(o.leadId || o.conversationId), {
  message: "Send leadId or conversationId.",
  path: ["leadId"],
});
export const createDraftQuoteInputSchema = createDraftQuoteBodySchema;
export type CreateDraftQuoteInput = z.infer<typeof createDraftQuoteBodySchema>;

// ── update_draft_quote ──────────────────────────────────────────────────────

const updateShape = {
  items: itemsSchema.optional().describe("Quantity / included changes to specific items. Items you do not name are unchanged."),
  notes: quoteNotes.nullable().optional().describe("null clears the notes."),
  validityDays: validityDays.optional(),
};
const NEED_ONE_CHANGE = { message: "Send at least one change: items, notes or validityDays." };
const update = build(updateShape);
export const updateDraftQuoteBodySchema = update.body.refine(hasAny, NEED_ONE_CHANGE);
export const updateDraftQuoteInputSchema = update.input.refine((o) => hasAny({ ...o, quotationId: undefined }), NEED_ONE_CHANGE);
export type UpdateDraftQuoteInput = z.infer<typeof updateDraftQuoteInputSchema>;

// ── revise_quote / submit_quote_for_approval / send_quote ──────────────────

const pathOnly = build({});
export const reviseQuoteBodySchema = pathOnly.body;
export const reviseQuoteInputSchema = pathOnly.input;
export const submitQuoteBodySchema = pathOnly.body;
export const submitQuoteInputSchema = pathOnly.input;
export const sendQuoteBodySchema = pathOnly.body;
export const sendQuoteInputSchema = pathOnly.input;
export type QuotePathInput = z.infer<typeof pathOnly.input>;

// ── request_discount (approval) ─────────────────────────────────────────────

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const discountShape = {
  lines: z
    .array(
      z.strictObject({
        rateItemId: z.string().trim().min(1).max(80),
        requestedRate: z
          .number()
          .gt(0)
          .max(MAX_RATE)
          .refine(twoDecimals, { message: "At most 2 decimal places." })
          .describe("The rate you are asking for, in INR per unit. It must be below the line's current rate."),
      }),
    )
    .min(1)
    .max(MAX_ITEMS)
    .optional()
    .describe("Ask for specific rates on specific lines. Send this or percent."),
  percent: z
    .number()
    .gt(0)
    .max(MAX_DISCOUNT_PERCENT)
    .refine(twoDecimals, { message: "At most 2 decimal places." })
    .optional()
    .describe(`Ask for this percentage off every included line (at most ${MAX_DISCOUNT_PERCENT}). Send this or lines.`),
  reason: text(500, 5).describe("Why the customer should get this discount. Shown to the person who approves."),
};
const exactlyOneDiscount = (o: { lines?: unknown; percent?: unknown }) => (o.lines !== undefined) !== (o.percent !== undefined);
const EXACTLY_ONE = { message: "Send either lines or percent, not both and not neither.", path: ["lines"] };
const discount = build(discountShape);
export const requestDiscountBodySchema = discount.body.refine(exactlyOneDiscount, EXACTLY_ONE);
export const requestDiscountInputSchema = discount.input.refine(exactlyOneDiscount, EXACTLY_ONE).superRefine((o, ctx) => {
  const seen = new Set<string>();
  (o.lines ?? []).forEach((l, i) => {
    if (seen.has(l.rateItemId)) ctx.addIssue({ code: "custom", path: ["lines", i, "rateItemId"], message: "Each rate item may be listed only once." });
    seen.add(l.rateItemId);
  });
});
export type RequestDiscountInput = z.infer<typeof requestDiscountInputSchema>;

// ── approve_quote (NEVER for the AI; stored by submit_quote_for_approval) ──

export const approveQuoteInputSchema = z.object({
  quotationId: id(),
  contentHash: z.string().min(8).max(64),
});
export type ApproveQuoteInput = z.infer<typeof approveQuoteInputSchema>;

// ── reads ───────────────────────────────────────────────────────────────────

export const listQuotesQuerySchema = z.object({
  leadId: optionalUuid,
  conversationId: optionalUuid,
  status: z.preprocess(blankToUndefined, z.enum(QUOTE_STATUSES).optional()),
  approvalState: z.preprocess(blankToUndefined, z.enum(APPROVAL_STATES).optional()),
  limit: limitParam,
  cursor: cursorParam,
});
export type ListQuotesInput = z.infer<typeof listQuotesQuerySchema>;

export const listQuoteTemplatesQuerySchema = z.object({ sport: sportSchema });

export const listInvoicesQuerySchema = z
  .object({
    leadId: optionalUuid,
    quotationId: optionalUuid,
    status: z.preprocess(blankToUndefined, z.enum(INVOICE_STATUSES).optional()),
    limit: limitParam,
    cursor: cursorParam,
  })
  .refine((o) => !!(o.leadId || o.quotationId), { message: "Send leadId or quotationId.", path: ["leadId"] });
export type ListInvoicesInput = z.infer<typeof listInvoicesQuerySchema>;

// ── responses ───────────────────────────────────────────────────────────────

const iso = z.string().describe("ISO 8601 timestamp");

export const quoteLineSchema = z.object({
  rateItemId: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: z.number().describe("Area in sq.ft, running ft, or number of pieces, depending on the unit"),
  ratePerUnit: z.number(),
  gstPercent: z.number(),
  amount: z.number().describe("Before GST"),
  gstAmount: z.number(),
  included: z.boolean(),
});

export const quoteSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  stage: z.enum(QUOTE_STAGES),
  status: z.enum(QUOTE_STATUSES),
  approvalState: z.enum(APPROVAL_STATES),
  approved: z.boolean().describe("true only after a person approved it: the only state in which it may be sent."),
  customerName: z.string(),
  sport: z.string(),
  lengthFt: z.number(),
  widthFt: z.number(),
  total: z.number().describe("Grand total in INR including GST"),
  createdByAgent: z.boolean(),
  parentQuotationId: z.string().nullable(),
  leadId: z.string().nullable(),
  conversationId: z.string().nullable(),
  createdAt: iso,
  sentAt: iso.nullable(),
});

export const quoteSchema = quoteSummarySchema.extend({
  kind: z.literal("quotation"),
  version: z.number(),
  notice: z.string().nullable().describe("Present unless the quotation is approved: do not present its price to the customer as final."),
  dealId: z.string().nullable(),
  phoneLast4: z.string().nullable(),
  currency: z.literal("INR"),
  plotAreaSqFt: z.number(),
  lines: z.array(quoteLineSchema),
  subtotal: z.number(),
  gst: z.number(),
  notes: z.string().nullable(),
  validityDays: z.number(),
  quoteDate: iso,
  validUntil: iso,
  approvedAt: iso.nullable(),
  approvedByUserId: z.string().nullable(),
  warnings: z.array(z.string()),
});

export const quoteResponseSchema = z.object({ quotation: quoteSchema });
export const createDraftQuoteResponseSchema = z.object({
  quotation: quoteSchema,
  deduplicated: z.boolean().describe("true when an identical draft was created in the last 10 minutes and is returned instead."),
});
export const submitQuoteResponseSchema = z.object({
  quotation: quoteSchema,
  approvalId: z.string(),
  status: z.literal("pending"),
});
export const listQuotesResponseSchema = z.object({ items: z.array(quoteSummarySchema), nextCursor: nextCursorSchema });

export const quotePdfResponseSchema = z.object({
  quotationId: z.string(),
  number: z.string(),
  approvalState: z.enum(APPROVAL_STATES),
  pdfUrl: z.string().describe("Internal (staff-only) link. Never give it to a customer."),
  staffOnly: z.boolean(),
  customerUrl: z.string().nullable().describe("The customer-facing link. Only present once a person approved the quotation."),
  notice: z.string().nullable(),
});

export const quoteHistoryResponseSchema = z.object({
  quotationId: z.string(),
  chain: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      version: z.number(),
      current: z.boolean(),
      status: z.enum(QUOTE_STATUSES),
      stage: z.enum(QUOTE_STAGES),
      approvalState: z.enum(APPROVAL_STATES),
      approvedAt: iso.nullable(),
      approvedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
      parentQuotationId: z.string().nullable(),
      createdByAgent: z.boolean(),
      total: z.number(),
      createdAt: iso,
      sentAt: iso.nullable(),
    }),
  ),
});

export const sendQuoteResponseSchema = z.object({
  sent: z.boolean(),
  quotationId: z.string(),
  number: z.string(),
  waMessageId: z.string().nullable(),
  mirrored: z.boolean(),
});

export const quoteTemplatesResponseSchema = z.object({
  sport: sportSchema,
  kind: z.literal("template"),
  editableByAgent: z.literal(false),
  sections: z.array(z.record(z.string(), z.unknown())),
});

export const discountResponseSchema = z.object({
  approvalId: z.string(),
  status: z.literal("pending"),
});

const invoiceSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  quotationId: z.string(),
  customerName: z.string(),
  sport: z.string(),
  status: z.enum(INVOICE_STATUSES),
  total: z.number(),
  amountPaid: z.number(),
  balance: z.number(),
  invoiceDate: iso,
  dueDate: iso,
  paidAt: iso.nullable(),
});
export const listInvoicesResponseSchema = z.object({ items: z.array(invoiceSummarySchema), nextCursor: nextCursorSchema });
export const invoiceResponseSchema = z.object({
  invoice: invoiceSummarySchema.extend({
    phoneLast4: z.string().nullable(),
    sport: z.string(),
    subtotal: z.number(),
    gst: z.number(),
    lines: z.array(quoteLineSchema),
    payments: z.array(z.object({ amount: z.number(), paidAt: iso, method: z.string().nullable() })),
  }),
});
