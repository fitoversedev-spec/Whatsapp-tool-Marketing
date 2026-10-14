import { describe, expect, it } from "vitest";
import {
  approveQuoteInputSchema,
  createDraftQuoteBodySchema,
  listInvoicesQuerySchema,
  listQuotesQuerySchema,
  requestDiscountInputSchema,
  sendQuoteInputSchema,
  updateDraftQuoteBodySchema,
  updateDraftQuoteInputSchema,
} from "../schemas/quotes";

const LEAD = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const QUOTE = "11111111-1111-4111-8111-111111111111";
const base = { leadId: LEAD, sport: "football", lengthFt: 100, widthFt: 50 };

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;
const message = (schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } }, v: unknown) =>
  JSON.stringify(schema.safeParse(v).error?.issues.map((i) => i.message));

describe("create_draft_quote input", () => {
  it("accepts the minimum and a full request", () => {
    expect(ok(createDraftQuoteBodySchema, base)).toBe(true);
    expect(
      ok(createDraftQuoteBodySchema, {
        conversationId: QUOTE,
        sport: "tennis",
        lengthFt: 78,
        widthFt: 36,
        items: [{ rateItemId: "posts", quantity: 2 }, { rateItemId: "fence", included: false }],
        notes: "Customer prefers blue courts",
        validityDays: 15,
      }),
    ).toBe(true);
  });

  it("a rate, price, total or tax anywhere in the request is rejected", () => {
    for (const extra of [{ rate: 90 }, { price: 1000 }, { total: 5 }, { grandTotal: 1 }, { gst: 0 }, { discount: 10 }, { subtotal: 1 }]) {
      expect(ok(createDraftQuoteBodySchema, { ...base, ...extra }), JSON.stringify(extra)).toBe(false);
    }
    for (const item of [{ rateItemId: "turf", ratePerUnit: 1 }, { rateItemId: "turf", rate: 1 }, { rateItemId: "turf", gstPercent: 0 }, { rateItemId: "turf", amount: 1 }]) {
      expect(ok(createDraftQuoteBodySchema, { ...base, items: [item] }), JSON.stringify(item)).toBe(false);
    }
  });

  it("needs a customer: leadId or conversationId", () => {
    expect(ok(createDraftQuoteBodySchema, { sport: "football", lengthFt: 10, widthFt: 10 })).toBe(false);
    expect(ok(createDraftQuoteBodySchema, { ...base, leadId: "not-an-id" })).toBe(false);
  });

  it("only supported sports", () => {
    expect(ok(createDraftQuoteBodySchema, { ...base, sport: "chess" })).toBe(false);
    expect(ok(createDraftQuoteBodySchema, { ...base, sport: "badminton" })).toBe(true);
  });

  it("dimensions are whole numbers from 1 to 10000", () => {
    for (const bad of [0, -5, 10_001, 12.5, Number.NaN, "100"]) {
      expect(ok(createDraftQuoteBodySchema, { ...base, lengthFt: bad }), String(bad)).toBe(false);
      expect(ok(createDraftQuoteBodySchema, { ...base, widthFt: bad }), String(bad)).toBe(false);
    }
    expect(ok(createDraftQuoteBodySchema, { ...base, lengthFt: 1, widthFt: 10_000 })).toBe(true);
  });

  it("quantities are whole numbers above zero and capped; each item once", () => {
    for (const q of [0, -1, 2.5, 10_001]) {
      expect(ok(createDraftQuoteBodySchema, { ...base, items: [{ rateItemId: "posts", quantity: q }] }), String(q)).toBe(false);
    }
    expect(ok(createDraftQuoteBodySchema, { ...base, items: [{ rateItemId: "posts", quantity: 10_000 }] })).toBe(true);
    expect(ok(createDraftQuoteBodySchema, { ...base, items: [{ rateItemId: "a" }, { rateItemId: "a" }] })).toBe(false);
    expect(ok(createDraftQuoteBodySchema, { ...base, items: Array.from({ length: 61 }, (_, i) => ({ rateItemId: `i${i}` })) })).toBe(false);
  });

  it("validity is 1 to 365 days", () => {
    expect(ok(createDraftQuoteBodySchema, { ...base, validityDays: 0 })).toBe(false);
    expect(ok(createDraftQuoteBodySchema, { ...base, validityDays: 366 })).toBe(false);
    expect(ok(createDraftQuoteBodySchema, { ...base, validityDays: 365 })).toBe(true);
  });

  it("notes are printed on the PDF, so prices, discounts and promises are refused", () => {
    expect(ok(createDraftQuoteBodySchema, { ...base, notes: "Site visit before work starts" })).toBe(true);
    for (const n of ["10% discount for you", "Total only Rs 5 lakh", "We guarantee completion", "special price", "₹1,50,000 all in"]) {
      expect(ok(createDraftQuoteBodySchema, { ...base, notes: n }), n).toBe(false);
    }
    expect(message(createDraftQuoteBodySchema, { ...base, notes: "20% discount" })).toContain("request_discount");
  });
});

describe("update_draft_quote input", () => {
  it("needs at least one change and takes the quotation id", () => {
    expect(ok(updateDraftQuoteBodySchema, {})).toBe(false);
    expect(ok(updateDraftQuoteBodySchema, { validityDays: 20 })).toBe(true);
    expect(ok(updateDraftQuoteBodySchema, { notes: null })).toBe(true);
    expect(ok(updateDraftQuoteInputSchema, { quotationId: QUOTE })).toBe(false);
    expect(ok(updateDraftQuoteInputSchema, { quotationId: QUOTE, items: [{ rateItemId: "posts", quantity: 3 }] })).toBe(true);
  });

  it("cannot name a rate, a dimension or a sport", () => {
    for (const extra of [{ rate: 1 }, { lengthFt: 10 }, { sport: "tennis" }, { total: 1 }]) {
      expect(ok(updateDraftQuoteInputSchema, { quotationId: QUOTE, validityDays: 20, ...extra }), JSON.stringify(extra)).toBe(false);
    }
    expect(ok(updateDraftQuoteInputSchema, { quotationId: QUOTE, items: [{ rateItemId: "posts", ratePerUnit: 5 }] })).toBe(false);
  });
});

describe("request_discount input", () => {
  const withId = { quotationId: QUOTE, reason: "Customer is ordering two courts" };

  it("takes either per-line requested rates or a percentage, not both, not neither", () => {
    expect(ok(requestDiscountInputSchema, { ...withId, lines: [{ rateItemId: "turf", requestedRate: 95.5 }] })).toBe(true);
    expect(ok(requestDiscountInputSchema, { ...withId, percent: 5 })).toBe(true);
    expect(ok(requestDiscountInputSchema, { ...withId, percent: 5, lines: [{ rateItemId: "turf", requestedRate: 95 }] })).toBe(false);
    expect(ok(requestDiscountInputSchema, withId)).toBe(false);
  });

  it("needs a reason, positive rates with at most 2 decimals, and a percentage up to 50", () => {
    expect(ok(requestDiscountInputSchema, { quotationId: QUOTE, percent: 5 })).toBe(false);
    for (const r of [0, -1, 1.234, 1_000_001]) {
      expect(ok(requestDiscountInputSchema, { ...withId, lines: [{ rateItemId: "turf", requestedRate: r }] }), String(r)).toBe(false);
    }
    for (const p of [0, -5, 50.01, 51, 100]) expect(ok(requestDiscountInputSchema, { ...withId, percent: p }), String(p)).toBe(false);
    expect(ok(requestDiscountInputSchema, { ...withId, percent: 50 })).toBe(true);
    expect(ok(requestDiscountInputSchema, { ...withId, lines: [{ rateItemId: "turf", requestedRate: 90 }, { rateItemId: "turf", requestedRate: 80 }] })).toBe(false);
  });
});

describe("path-only tools and approvals", () => {
  it("send_quote takes nothing but the id: no recipient, no text", () => {
    expect(ok(sendQuoteInputSchema, { quotationId: QUOTE })).toBe(true);
    expect(ok(sendQuoteInputSchema, { quotationId: QUOTE, to: "919999999999" })).toBe(false);
    expect(ok(sendQuoteInputSchema, { quotationId: QUOTE, caption: "Special offer" })).toBe(false);
    expect(ok(sendQuoteInputSchema, { quotationId: "x" })).toBe(false);
  });

  it("approve_quote input is the id and the content hash", () => {
    expect(ok(approveQuoteInputSchema, { quotationId: QUOTE, contentHash: "abcdef0123456789" })).toBe(true);
    expect(ok(approveQuoteInputSchema, { quotationId: QUOTE })).toBe(false);
  });
});

describe("read queries", () => {
  it("list_quotes takes optional filters and a bounded limit", () => {
    expect(ok(listQuotesQuerySchema, {})).toBe(true);
    expect(ok(listQuotesQuerySchema, { leadId: LEAD, status: "draft", approvalState: "approved", limit: "50" })).toBe(true);
    expect(ok(listQuotesQuerySchema, { status: "bogus" })).toBe(false);
    expect(ok(listQuotesQuerySchema, { limit: "500" })).toBe(false);
    expect(ok(listQuotesQuerySchema, { leadId: "nope" })).toBe(false);
  });

  it("list_invoices needs a lead or a quotation", () => {
    expect(ok(listInvoicesQuerySchema, {})).toBe(false);
    expect(ok(listInvoicesQuerySchema, { leadId: LEAD })).toBe(true);
    expect(ok(listInvoicesQuerySchema, { quotationId: QUOTE, status: "paid" })).toBe(true);
  });
});
