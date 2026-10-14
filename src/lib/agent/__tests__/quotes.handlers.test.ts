import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  accountContact: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn(), update: vi.fn() },
  quotation: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  deal: { findUnique: vi.fn(), update: vi.fn() },
  dealLineItem: { createMany: vi.fn(), deleteMany: vi.fn() },
  sport: { findUnique: vi.fn() },
  setting: { findUnique: vi.fn() },
  optOut: { findFirst: vi.fn() },
  agentApprovalRequest: { findFirst: vi.fn() },
  message: { create: vi.fn() },
  user: { findMany: vi.fn() },
  invoice: { findMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const ext = vi.hoisted(() => ({
  resolveContactForDocument: vi.fn(),
  scheduleQuoteFollowUp: vi.fn(),
  ensureQuotationPdf: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  isMetaConfigured: vi.fn(),
  resolveWhatsAppDelivery: vi.fn(),
  requestApproval: vi.fn(),
}));
vi.mock("@/lib/crm/contactLinks", () => ({
  resolveContactForDocument: ext.resolveContactForDocument,
  scheduleQuoteFollowUp: ext.scheduleQuoteFollowUp,
}));
vi.mock("@/lib/quotation/pdf-cache", () => ({
  ensureQuotationPdf: ext.ensureQuotationPdf,
  quotationFileName: (q: { number: string }) => `${q.number}.pdf`,
}));
vi.mock("@/lib/whatsapp", () => ({
  sendText: ext.sendText,
  sendMedia: ext.sendMedia,
  isMetaConfigured: ext.isMetaConfigured,
  describeMetaError: (e: { code?: string; message?: string }) => ({ code: e?.code ?? "x", message: e?.message ?? "boom" }),
}));
vi.mock("@/lib/whatsapp-delivery", () => ({ resolveWhatsAppDelivery: ext.resolveWhatsAppDelivery }));
vi.mock("../approvals", () => ({ requestApproval: ext.requestApproval }));

import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import {
  approveQuoteExecutor,
  requestDiscountExecutor,
  requestDiscountHandler,
  submitQuoteForApproval,
} from "../quotes/approval";
import { createDraftQuote, reviseQuote, updateDraftQuote } from "../quotes/drafts";
import { buildQuoteLines, quoteContentHash, resolveItemSettings } from "../quotes/logic";
import { getInvoice, getQuote, getQuotePdf, listInvoices, listQuotes, quoteHistory } from "../quotes/reads";
import { sendQuote } from "../quotes/send";
import type { RateSheetItem } from "@/lib/quotation/rates";

const AI = "ai-user";
const ctx: AgentContext = {
  identityId: "idn",
  userId: AI,
  credentialId: "cred",
  environment: "staging",
  correlationId: "corr-0001",
  ip: null,
};
const LEAD = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const QUOTE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONVO = "33333333-3333-4333-8333-333333333333";
const DEAL = "44444444-4444-4444-8444-444444444444";
const PHONE = "919876543210";

const SHEET: RateSheetItem[] = [
  { id: "base", name: "Base", description: "d", areaMode: "plot", defaultRate: 100, gstPercent: 5 },
  { id: "turf", name: "Turf", description: "d", areaMode: "plot", defaultRate: 50, gstPercent: 18 },
  { id: "posts", name: "Posts", description: "d", areaMode: "per_piece", defaultRate: 2000, gstPercent: 18, optional: true },
];
let sheet = SHEET;

function priced(s: RateSheetItem[] = SHEET, patches?: Parameters<typeof resolveItemSettings>[0]["patches"]) {
  const { settings, named } = resolveItemSettings({ sheet: s, patches });
  return buildQuoteLines({ sheet: s, lengthFt: 100, widthFt: 50, settings, named });
}

function quoteRow(over: Record<string, unknown> = {}) {
  const b = priced();
  return {
    id: QUOTE,
    number: "FIT-QT-2026-001",
    customerName: "Ravi",
    sport: "football",
    lengthFt: 100,
    widthFt: 50,
    lineItems: JSON.stringify(b.lines),
    subtotal: b.totals.subtotal,
    gstAmount: b.totals.gstAmount,
    grandTotal: b.totals.grandTotal,
    notes: null,
    caption: null,
    pdfUrl: null,
    status: "draft",
    quoteDate: new Date("2026-10-13T00:00:00Z"),
    validityDays: 30,
    sentAt: null,
    conversationId: null,
    contactPhone: PHONE,
    createdByUserId: AI,
    dealId: null,
    version: 1,
    isPrimary: true,
    salespersonPhone: null,
    sections: null,
    accountContactId: LEAD,
    approvalState: "none",
    approvedByUserId: null,
    approvedAt: null,
    parentQuotationId: null,
    agentOrigin: true,
    createdAt: new Date("2026-10-13T00:00:00Z"),
    updatedAt: new Date("2026-10-13T00:00:00Z"),
    ...over,
  };
}

const contact = (over: Record<string, unknown> = {}) => ({
  id: LEAD,
  name: "Ravi",
  phone: PHONE,
  accountId: "acc-1",
  deletedAt: null,
  account: { deletedAt: null },
  ...over,
});

const run = <I>(h: (a: never) => Promise<unknown>, input: I, params: Record<string, string> = {}) =>
  (h as unknown as (a: unknown) => Promise<{ status?: number; body: any; recordIds?: string[] }>)({
    ctx,
    meta: {},
    input,
    req: new Request("https://app.test/x"),
    params,
    idempotencyKey: "idem-key-0001",
  });

beforeEach(() => {
  vi.clearAllMocks();
  sheet = SHEET;
  db.setting.findUnique.mockImplementation(async () => ({ value: JSON.stringify(sheet) }));
  db.accountContact.findUnique.mockResolvedValue(contact());
  db.conversation.findUnique.mockResolvedValue(null);
  db.quotation.findUnique.mockResolvedValue(null);
  db.quotation.findMany.mockResolvedValue([]);
  db.quotation.findFirst.mockResolvedValue(null);
  db.quotation.updateMany.mockResolvedValue({ count: 1 });
  db.quotation.update.mockResolvedValue({});
  db.quotation.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => quoteRow({ ...data, id: OTHER }));
  db.deal.findUnique.mockResolvedValue(null);
  db.deal.update.mockResolvedValue(null);
  db.sport.findUnique.mockResolvedValue({ id: "sport-1" });
  db.optOut.findFirst.mockResolvedValue(null);
  db.agentApprovalRequest.findFirst.mockResolvedValue(null);
  db.message.create.mockResolvedValue({});
  db.conversation.update.mockResolvedValue({});
  ext.resolveContactForDocument.mockResolvedValue(null);
  ext.ensureQuotationPdf.mockResolvedValue({ url: "https://blob.test/q.pdf", key: "k" });
  ext.isMetaConfigured.mockResolvedValue(true);
  ext.sendText.mockResolvedValue({ waMessageId: "wamid.text" });
  ext.sendMedia.mockResolvedValue({ waMessageId: "wamid.doc" });
  ext.resolveWhatsAppDelivery.mockResolvedValue({ mode: "cloud-api", conversationId: CONVO, normalizedPhone: PHONE });
  ext.requestApproval.mockResolvedValue({ approvalId: "appr-1", created: true });
});

const createData = () => db.quotation.create.mock.calls[0][0].data as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────

describe("create_draft_quote", () => {
  const input = { leadId: LEAD, sport: "football" as const, lengthFt: 100, widthFt: 50 };

  it("saves a DRAFT whose lines and totals come from the rate sheet, owned by the AI", async () => {
    const res = await run(createDraftQuote, input);
    const data = createData();
    expect(data).toMatchObject({
      status: "draft",
      agentOrigin: true,
      approvalState: "none",
      createdByUserId: AI,
      accountContactId: LEAD,
      customerName: "Ravi",
      contactPhone: PHONE,
      subtotal: 750_000,
      gstAmount: 70_000,
      grandTotal: 820_000,
      validityDays: 30,
    });
    expect(data.parentQuotationId).toBeUndefined();
    expect(data.number).toMatch(/^FIT-QT-\d{4}-001$/);
    const lines = JSON.parse(data.lineItems) as { id: string; ratePerSqFt: number; gstPercent: number; included: boolean }[];
    for (const l of lines) {
      const s = SHEET.find((x) => x.id === l.id)!;
      expect([l.ratePerSqFt, l.gstPercent]).toEqual([s.defaultRate, s.gstPercent]);
    }
    expect(res.body.deduplicated).toBe(false);
    expect(res.body.quotation).toMatchObject({ stage: "draft", approved: false, approvalState: "none", total: 820_000 });
    expect(res.body.quotation.notice).toMatch(/DRAFT/);
  });

  it("re-reads the rates every time: a changed sheet changes the draft, a caller cannot", async () => {
    sheet = SHEET.map((s) => (s.id === "base" ? { ...s, defaultRate: 120 } : s));
    await run(createDraftQuote, input);
    expect(createData().grandTotal).toBe((5000 * 120 * 1.05 + 5000 * 50 * 1.18) | 0);
  });

  it("returns the existing draft when the same one was made in the last 10 minutes", async () => {
    db.quotation.findMany.mockResolvedValue([quoteRow({ id: OTHER })]);
    const res = await run(createDraftQuote, input);
    expect(res.body.deduplicated).toBe(true);
    expect(res.body.quotation.id).toBe(OTHER);
    expect(db.quotation.create).not.toHaveBeenCalled();
    // looked only at the AI's own recent drafts for this lead
    const where = db.quotation.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ agentOrigin: true, status: "draft", OR: [{ accountContactId: LEAD }] });
    expect(where.createdAt.gte.getTime()).toBeGreaterThan(Date.now() - 11 * 60_000);
  });

  it("a different draft for the same lead is not a duplicate", async () => {
    db.quotation.findMany.mockResolvedValue([quoteRow({ id: OTHER, lengthFt: 90 })]);
    const res = await run(createDraftQuote, input);
    expect(res.body.deduplicated).toBe(false);
    expect(db.quotation.create).toHaveBeenCalledTimes(1);
  });

  it("takes the next number when two quotes race for the same one (P2002)", async () => {
    db.quotation.create
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }))
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => quoteRow({ ...data, id: OTHER }));
    await run(createDraftQuote, input);
    expect(db.quotation.create).toHaveBeenCalledTimes(2);
    expect(db.quotation.create.mock.calls[0][0].data.number).toMatch(/-001$/);
    expect(db.quotation.create.mock.calls[1][0].data.number).toMatch(/-002$/);
  });

  it("any other database error is not retried", async () => {
    db.quotation.create.mockRejectedValue(Object.assign(new Error("boom"), { code: "P2003" }));
    await expect(run(createDraftQuote, input)).rejects.toThrow("boom");
    expect(db.quotation.create).toHaveBeenCalledTimes(1);
  });

  it("refuses unknown rate items and a per-piece item without a quantity", async () => {
    await expect(run(createDraftQuote, { ...input, items: [{ rateItemId: "gold" }] })).rejects.toMatchObject({ status: 400 });
    await expect(run(createDraftQuote, { ...input, items: [{ rateItemId: "posts" }] })).rejects.toMatchObject({ status: 400 });
    expect(db.quotation.create).not.toHaveBeenCalled();
  });

  it("an optional per-piece item with a quantity goes on the draft at the sheet's rate", async () => {
    await run(createDraftQuote, { ...input, items: [{ rateItemId: "posts", quantity: 3 }] });
    const posts = (JSON.parse(createData().lineItems) as any[]).find((l) => l.id === "posts");
    expect(posts).toMatchObject({ included: true, areaSqFt: 3, ratePerSqFt: 2000, total: 6000 });
    expect(createData().grandTotal).toBe(820_000 + 6000 * 1.18);
  });

  it("404 for a lead that does not exist or was deleted", async () => {
    db.accountContact.findUnique.mockResolvedValue(null);
    await expect(run(createDraftQuote, input)).rejects.toMatchObject({ status: 404 });
    db.accountContact.findUnique.mockResolvedValue(contact({ deletedAt: new Date() }));
    await expect(run(createDraftQuote, input)).rejects.toMatchObject({ status: 404 });
  });

  it("works from a conversation, resolving the CRM contact the way the human wizard does", async () => {
    db.conversation.findUnique.mockResolvedValue({ id: CONVO, contactPhone: PHONE, contactName: "Ravi K" });
    ext.resolveContactForDocument.mockResolvedValue({ id: LEAD, explicit: false, canView: false, canEdit: false });
    await run(createDraftQuote, { conversationId: CONVO, sport: "football", lengthFt: 100, widthFt: 50 });
    expect(ext.resolveContactForDocument).toHaveBeenCalledWith({ conversationId: CONVO }, { id: AI, role: "ai_agent" });
    expect(createData()).toMatchObject({ conversationId: CONVO, accountContactId: LEAD, contactPhone: PHONE });
  });

  it("refuses a lead and a conversation that are different people", async () => {
    db.conversation.findUnique.mockResolvedValue({ id: CONVO, contactPhone: "919000000000", contactName: null });
    await expect(run(createDraftQuote, { ...input, conversationId: CONVO })).rejects.toMatchObject({ status: 409 });
  });

  it("on a deal: demotes the old primary quote, sets the quoted value and writes DealLineItems", async () => {
    db.deal.findUnique.mockResolvedValue({ id: DEAL, accountId: "acc-1", deletedAt: null });
    db.deal.update.mockResolvedValue({ conversationId: null, wonValue: null, quotedValue: 820_000 });
    await run(createDraftQuote, { ...input, dealId: DEAL });
    expect(db.quotation.updateMany).toHaveBeenCalledWith({ where: { dealId: DEAL, isPrimary: true }, data: { isPrimary: false } });
    expect(db.deal.update).toHaveBeenCalledWith({ where: { id: DEAL }, data: { quotedValue: 820_000 } });
    const rows = db.dealLineItem.createMany.mock.calls[0][0].data as { rate: number; dealId: string }[];
    expect(rows.map((r) => r.rate).sort()).toEqual([100, 50]);
    expect(rows.every((r) => r.dealId === DEAL)).toBe(true);
  });

  it("refuses a deal that belongs to someone else", async () => {
    db.deal.findUnique.mockResolvedValue({ id: DEAL, accountId: "acc-OTHER", deletedAt: null });
    await expect(run(createDraftQuote, { ...input, dealId: DEAL })).rejects.toMatchObject({ status: 409 });
    expect(db.quotation.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("update_draft_quote", () => {
  const found = (over: Record<string, unknown> = {}) => db.quotation.findUnique.mockResolvedValue(quoteRow(over));

  it.each([
    ["a quote a person made", { agentOrigin: false }],
    ["a quote waiting for approval", { approvalState: "pending" }],
    ["an approved quote", { approvalState: "approved" }],
    ["a sent quote", { status: "sent" }],
  ])("refuses to edit %s", async (_label, over) => {
    found(over);
    // a quote marked pending is only believed while its approval request is still open
    db.agentApprovalRequest.findFirst.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() + 3_600_000) });
    const res = await run(updateDraftQuote, { quotationId: QUOTE, validityDays: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_editable");
    expect(db.quotation.updateMany).not.toHaveBeenCalled();
  });

  it("changes quantities and flags, re-pricing the WHOLE quote from the current sheet", async () => {
    found();
    sheet = SHEET.map((s) => (s.id === "turf" ? { ...s, defaultRate: 60 } : s));
    const res = await run(updateDraftQuote, { quotationId: QUOTE, items: [{ rateItemId: "posts", quantity: 2 }] });
    const call = db.quotation.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: QUOTE, agentOrigin: true, status: "draft", approvalState: { in: ["none", "rejected"] } });
    const lines = JSON.parse(call.data.lineItems) as any[];
    expect(lines.find((l) => l.id === "turf").ratePerSqFt).toBe(60);
    expect(lines.find((l) => l.id === "posts")).toMatchObject({ included: true, areaSqFt: 2, ratePerSqFt: 2000 });
    expect(call.data).toMatchObject({ approvalState: "none", approvedByUserId: null, approvedAt: null, pdfUrl: null });
    expect(call.data.grandTotal).toBeCloseTo(5000 * 100 * 1.05 + 5000 * 60 * 1.18 + 4000 * 1.18, 2);
    expect(res.body.quotation).toBeDefined();
  });

  it("a rejected draft goes back to 'none' when edited", async () => {
    found({ approvalState: "rejected" });
    await run(updateDraftQuote, { quotationId: QUOTE, notes: null });
    expect(db.quotation.updateMany.mock.calls[0][0].data).toMatchObject({ approvalState: "none", notes: null });
  });

  it("answers 409 if the quote moved on between the check and the write", async () => {
    found();
    db.quotation.updateMany.mockResolvedValue({ count: 0 });
    const res = await run(updateDraftQuote, { quotationId: QUOTE, validityDays: 10 });
    expect(res.status).toBe(409);
  });

  it("404 for a quote that does not exist", async () => {
    await expect(run(updateDraftQuote, { quotationId: QUOTE, validityDays: 10 })).rejects.toMatchObject({ status: 404 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("revise_quote: the version chain", () => {
  it("clones into a NEW draft linked to the old one, priced from the CURRENT sheet", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "approved", approvedByUserId: "boss", status: "sent", version: 2 }));
    sheet = SHEET.map((s) => (s.id === "base" ? { ...s, defaultRate: 110 } : s));
    const res = await run(reviseQuote, { quotationId: QUOTE });
    const data = createData();
    expect(data).toMatchObject({
      parentQuotationId: QUOTE,
      version: 3,
      status: "draft",
      approvalState: "none",
      agentOrigin: true,
      createdByUserId: AI,
      accountContactId: LEAD,
      contactPhone: PHONE,
    });
    expect(data.approvedByUserId).toBeUndefined();
    expect(data.number).toMatch(/^FIT-QT-\d{4}-001$/);
    expect((JSON.parse(data.lineItems) as any[]).find((l) => l.id === "base").ratePerSqFt).toBe(110);
    // the old quote is history: nothing writes to it
    expect(db.quotation.update).not.toHaveBeenCalled();
    expect(db.quotation.updateMany).not.toHaveBeenCalled();
    expect(res.body.quotation).toMatchObject({ parentQuotationId: QUOTE, approved: false });
    expect(res.body.quotation.warnings.join(" ")).toMatch(/current rate sheet/);
  });

  it("keeps the old scope: lines that were in stay in, with their piece counts", async () => {
    const b = priced(SHEET, [{ rateItemId: "posts", quantity: 5 }]);
    db.quotation.findUnique.mockResolvedValue(
      quoteRow({ lineItems: JSON.stringify(b.lines), subtotal: b.totals.subtotal, gstAmount: b.totals.gstAmount, grandTotal: b.totals.grandTotal }),
    );
    await run(reviseQuote, { quotationId: QUOTE });
    const posts = (JSON.parse(createData().lineItems) as any[]).find((l) => l.id === "posts");
    expect(posts).toMatchObject({ included: true, areaSqFt: 5 });
  });

  it("a revision asked for twice is one revision", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow());
    db.quotation.findMany.mockResolvedValue([quoteRow({ id: OTHER, parentQuotationId: QUOTE })]);
    const res = await run(reviseQuote, { quotationId: QUOTE });
    expect(res.body.quotation.id).toBe(OTHER);
    expect(db.quotation.create).not.toHaveBeenCalled();
    expect(db.quotation.findMany.mock.calls[0][0].where).toMatchObject({ parentQuotationId: QUOTE });
  });
});

describe("history", () => {
  it("walks up to the first quote and down through revisions", async () => {
    const mk = (id: string, over: Record<string, unknown>) => quoteRow({ id, number: `N-${id}`, ...over });
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const rows: Record<string, any> = {
      [A]: mk(A, { createdAt: new Date("2026-10-01"), approvalState: "approved", approvedByUserId: "boss", approvedAt: new Date("2026-10-02") }),
      [B]: mk(B, { createdAt: new Date("2026-10-05"), version: 2, parentQuotationId: A }),
      [C]: mk(C, { createdAt: new Date("2026-10-09"), version: 3, parentQuotationId: B }),
    };
    db.quotation.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null);
    db.quotation.findMany.mockResolvedValueOnce([rows[B]]).mockResolvedValueOnce([rows[C]]).mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([{ id: "boss", name: "Priya" }]);
    const res = await run(quoteHistory, undefined, { id: B });
    expect(res.body.chain.map((c: any) => c.id)).toEqual([A, B, C]);
    expect(res.body.chain.map((c: any) => c.current)).toEqual([false, true, false]);
    expect(res.body.chain[0]).toMatchObject({ approvalState: "approved", approvedBy: { id: "boss", name: "Priya" }, stage: "approved" });
    expect(res.body.chain[2]).toMatchObject({ approvalState: "none", stage: "draft" });
    expect(res.body.chain[1].parentQuotationId).toBe(A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("submit_quote_for_approval", () => {
  it("queues an approve_quote request that carries the content hash, and marks the draft pending", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow());
    const res = await run(submitQuoteForApproval, { quotationId: QUOTE });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ approvalId: "appr-1", status: "pending" });
    expect(res.body.quotation).toMatchObject({ approvalState: "pending", stage: "pending_approval", approved: false });
    const call = ext.requestApproval.mock.calls[0][0];
    expect(call).toMatchObject({ identityId: "idn", toolName: "approve_quote" });
    expect(call.input).toMatchObject({ quotationId: QUOTE, total: 820_000, quoteNumber: "FIT-QT-2026-001" });
    expect(call.input.contentHash).toBe(
      quoteContentHash({ sport: "football", lengthFt: 100, widthFt: 50, lines: priced().lines, notes: null, validityDays: 30 }),
    );
    expect(call.input.lines).toHaveLength(2);
    expect(db.quotation.updateMany).toHaveBeenCalledWith({
      where: { id: QUOTE, agentOrigin: true, status: "draft", approvalState: { in: ["none", "rejected"] } },
      data: { approvalState: "pending", approvedByUserId: null, approvedAt: null },
    });
  });

  it("an already-pending quote returns its request again without a second state change", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "pending" }));
    db.agentApprovalRequest.findFirst.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() + 3_600_000) });
    ext.requestApproval.mockResolvedValue({ approvalId: "appr-1", created: false });
    const res = await run(submitQuoteForApproval, { quotationId: QUOTE });
    expect(res.body.approvalId).toBe("appr-1");
    expect(db.quotation.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a quote a person made", { agentOrigin: false }, "not_submittable"],
    ["a sent quote", { status: "sent" }, "not_submittable"],
    ["an approved quote", { approvalState: "approved" }, "already_approved"],
    ["a quote whose totals no longer match its lines", { grandTotal: 1 }, "quote_inconsistent"],
  ])("refuses %s", async (_l, over, code) => {
    db.quotation.findUnique.mockResolvedValue(quoteRow(over));
    const res = await run(submitQuoteForApproval, { quotationId: QUOTE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(code);
    expect(ext.requestApproval).not.toHaveBeenCalled();
  });

  it("a pending request that a person rejected frees the quote to be edited and submitted again", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "pending" }));
    db.agentApprovalRequest.findFirst.mockResolvedValue({ status: "rejected", expiresAt: new Date(Date.now() + 3_600_000) });
    const res = await run(getQuote, undefined, { id: QUOTE });
    expect(db.quotation.updateMany).toHaveBeenCalledWith({ where: { id: QUOTE, approvalState: "pending" }, data: { approvalState: "rejected" } });
    expect(res.body.quotation.approvalState).toBe("rejected");
    expect(res.body.quotation.stage).toBe("draft");
  });

  it("a request that ran out its 24 hours puts the quote back to 'none'", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "pending" }));
    db.agentApprovalRequest.findFirst.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() - 1000) });
    const res = await run(getQuote, undefined, { id: QUOTE });
    expect(res.body.quotation.approvalState).toBe("none");
  });
});

describe("approve_quote executor (a person approved the request)", () => {
  const hashOfRow = (r = quoteRow()) =>
    quoteContentHash({ sport: r.sport, lengthFt: r.lengthFt, widthFt: r.widthFt, lines: JSON.parse(r.lineItems), notes: r.notes, validityDays: r.validityDays });
  const exec = (input: unknown) => approveQuoteExecutor({ ctx, input, approvalId: "appr-1", approvedByUserId: "boss" });

  it("marks the quote approved, by that person, at that time", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "pending" }));
    const res = await exec({ quotationId: QUOTE, contentHash: hashOfRow() });
    expect(res.status).toBe(200);
    const call = db.quotation.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: QUOTE, approvalState: "pending" });
    expect(call.data).toMatchObject({ approvalState: "approved", approvedByUserId: "boss" });
    expect(call.data.approvedAt).toBeInstanceOf(Date);
  });

  it("does NOT approve a quote that changed after it was submitted", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "pending", lengthFt: 120 }));
    const res = await exec({ quotationId: QUOTE, contentHash: hashOfRow() });
    expect(res.status).toBe(409);
    expect((res.body as any).error.code).toBe("quote_changed");
    expect(db.quotation.updateMany).toHaveBeenCalledWith({ where: { id: QUOTE, approvalState: "pending" }, data: { approvalState: "none" } });
  });

  it("does nothing for a quote that is not pending, or does not exist", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "none" }));
    expect((await exec({ quotationId: QUOTE, contentHash: hashOfRow() })).status).toBe(409);
    db.quotation.findUnique.mockResolvedValue(null);
    expect((await exec({ quotationId: QUOTE, contentHash: hashOfRow() })).status).toBe(404);
    expect((await exec({ nope: 1 })).status).toBe(400);
    expect(db.quotation.updateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("send_quote: draft vs approved", () => {
  const approved = (over: Record<string, unknown> = {}) =>
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "approved", approvedByUserId: "boss", ...over }));
  const body = { quotationId: QUOTE };

  it.each([
    ["a draft", { approvalState: "none" }],
    ["a quote waiting for approval", { approvalState: "pending" }],
    ["a rejected quote", { approvalState: "rejected" }],
  ])("%s is refused with 403 quote_not_approved, and nothing is rendered or sent", async (_l, over) => {
    db.quotation.findUnique.mockResolvedValue(quoteRow(over));
    if (over.approvalState === "pending") db.agentApprovalRequest.findFirst.mockResolvedValue({ status: "pending", expiresAt: new Date(Date.now() + 3_600_000) });
    const res = await run(sendQuote, body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("quote_not_approved");
    expect(res.body.error.message).toMatch(/submit_quote_for_approval/);
    expect(ext.ensureQuotationPdf).not.toHaveBeenCalled();
    expect(ext.sendText).not.toHaveBeenCalled();
    expect(ext.sendMedia).not.toHaveBeenCalled();
    expect(ext.resolveWhatsAppDelivery).not.toHaveBeenCalled();
  });

  it("sends an approved quote: caption then the saved PDF, to the quote's own number", async () => {
    approved();
    const res = await run(sendQuote, body);
    expect(res.status).toBeUndefined();
    expect(res.body).toMatchObject({ sent: true, quotationId: QUOTE, waMessageId: "wamid.doc", mirrored: true });
    expect(ext.sendText).toHaveBeenCalledWith({ to: PHONE, body: expect.stringContaining("FIT-QT-2026-001") });
    expect(ext.sendMedia).toHaveBeenCalledWith({ to: PHONE, mediaType: "document", url: "https://blob.test/q.pdf", filename: "FIT-QT-2026-001.pdf" });
    // recorded: draft -> sent, then the inbox mirror credits the AI
    expect(db.quotation.updateMany).toHaveBeenCalledWith({ where: { id: QUOTE, status: "draft" }, data: { status: "sent" } });
    expect(db.quotation.update).toHaveBeenCalledWith({ where: { id: QUOTE }, data: expect.objectContaining({ status: "sent", pdfUrl: "https://blob.test/q.pdf" }) });
    expect(db.message.create.mock.calls.every((c) => c[0].data.sentByUserId === AI)).toBe(true);
  });

  it("outside the 24-hour window: handoff_required, and NOTHING is sent or changed", async () => {
    approved();
    ext.resolveWhatsAppDelivery.mockResolvedValue({ mode: "whatsapp-web", conversationId: null, normalizedPhone: PHONE });
    const res = await run(sendQuote, body);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "handoff_required" }, handoffRequired: true, sent: false });
    expect(ext.sendText).not.toHaveBeenCalled();
    expect(ext.sendMedia).not.toHaveBeenCalled();
    expect(db.quotation.update).not.toHaveBeenCalled();
    expect(db.quotation.updateMany).not.toHaveBeenCalled();
    expect(ext.ensureQuotationPdf).not.toHaveBeenCalled();
  });

  it("never messages an opted-out customer", async () => {
    approved();
    db.optOut.findFirst.mockResolvedValue({ phoneE164: PHONE });
    const res = await run(sendQuote, body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("opted_out");
    expect(ext.sendMedia).not.toHaveBeenCalled();
  });

  it("the resend guard: no second send within 10 minutes", async () => {
    approved({ status: "sent", sentAt: new Date(Date.now() - 5 * 60_000) });
    const res = await run(sendQuote, body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("recently_sent");
    expect(ext.sendMedia).not.toHaveBeenCalled();
    approved({ status: "sent", sentAt: new Date(Date.now() - 11 * 60_000) });
    expect((await run(sendQuote, body)).body.sent).toBe(true);
  });

  it("refuses a quote with no phone, one that is already closed, and one whose numbers were tampered with", async () => {
    approved({ contactPhone: null });
    expect((await run(sendQuote, body)).body.error.code).toBe("no_contact_phone");
    approved({ status: "accepted" });
    expect((await run(sendQuote, body)).body.error.code).toBe("not_sendable");
    approved({ grandTotal: 5 });
    expect((await run(sendQuote, body)).body.error.code).toBe("quote_inconsistent");
    expect(ext.sendMedia).not.toHaveBeenCalled();
  });

  it("a send failure is an error and the quote is not marked sent", async () => {
    approved();
    ext.sendMedia.mockRejectedValue({ code: "131047", message: "Re-engagement" });
    await expect(run(sendQuote, body)).rejects.toMatchObject({ status: 502 });
    expect(db.quotation.update).not.toHaveBeenCalled();
  });

  it("a timeout is reported as unknown delivery, not retried blindly", async () => {
    approved();
    ext.sendMedia.mockRejectedValue({ code: "timeout", message: "slow" });
    const res = await run(sendQuote, body);
    expect(res.body.error.code).toBe("delivery_unknown");
  });

  it("the 3-day follow-up goes to the customer's rep, and is skipped when there is none", async () => {
    approved();
    db.accountContact.findUnique.mockResolvedValue({ account: { ownerUserId: "rep-1" } });
    await run(sendQuote, body);
    expect(ext.scheduleQuoteFollowUp).toHaveBeenCalledWith(expect.objectContaining({ quotationNumber: "FIT-QT-2026-001", actorUserId: AI }));
    ext.scheduleQuoteFollowUp.mockClear();
    db.accountContact.findUnique.mockResolvedValue({ account: { ownerUserId: null } });
    await run(sendQuote, body);
    expect(ext.scheduleQuoteFollowUp).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("request_discount", () => {
  const exec = (input: unknown) => requestDiscountExecutor({ ctx, input, approvalId: "appr-2", approvedByUserId: "boss" });
  const origin = (over: Record<string, unknown> = {}) => db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "approved", status: "sent", ...over }));
  const reason = "Customer is ordering two courts";

  it("the handler itself never applies anything: only the approved executor does", async () => {
    await expect(run(requestDiscountHandler, {})).rejects.toBeInstanceOf(AgentHttpError);
  });

  it("applies ONLY the approved rate, to a NEW revision that the approver signs off; the original is untouched", async () => {
    origin();
    const res = await exec({ quotationId: QUOTE, lines: [{ rateItemId: "base", requestedRate: 90 }], reason });
    expect(res.status).toBe(200);
    const data = createData();
    const lines = JSON.parse(data.lineItems) as any[];
    expect(lines.find((l) => l.id === "base").ratePerSqFt).toBe(90);
    // every other line is exactly what it was
    expect(lines.find((l) => l.id === "turf")).toMatchObject({ ratePerSqFt: 50, gstPercent: 18 });
    expect(lines.find((l) => l.id === "posts")).toMatchObject({ ratePerSqFt: 2000, included: false });
    expect(data).toMatchObject({
      parentQuotationId: QUOTE,
      version: 2,
      approvalState: "approved",
      approvedByUserId: "boss",
      agentOrigin: true,
      status: "draft",
      createdByUserId: AI,
      grandTotal: 5000 * 90 * 1.05 + 5000 * 50 * 1.18,
    });
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect((res.body as any).changes).toEqual([{ rateItemId: "base", name: "Base", from: 100, to: 90 }]);
    expect(db.quotation.update).not.toHaveBeenCalled();
    expect(db.quotation.updateMany).not.toHaveBeenCalled();
  });

  it("a percentage touches every included line and no excluded one", async () => {
    origin();
    await exec({ quotationId: QUOTE, percent: 10, reason });
    const lines = JSON.parse(createData().lineItems) as any[];
    expect(lines.find((l) => l.id === "base").ratePerSqFt).toBe(90);
    expect(lines.find((l) => l.id === "turf").ratePerSqFt).toBe(45);
    expect(lines.find((l) => l.id === "posts").ratePerSqFt).toBe(2000);
  });

  it("refuses a 'discount' that would raise a rate, hit zero or go past 50%: nothing is created", async () => {
    origin();
    for (const requestedRate of [100, 130, 49]) {
      const res = await exec({ quotationId: QUOTE, lines: [{ rateItemId: "base", requestedRate }], reason });
      expect(res.status).toBe(422);
      expect((res.body as any).error.code).toBe("invalid_discount");
    }
    expect((await exec({ quotationId: QUOTE, lines: [{ rateItemId: "nope", requestedRate: 1 }], reason })).status).toBe(422);
    expect(db.quotation.create).not.toHaveBeenCalled();
  });

  it("re-checks the stored request: a malformed one (even a rate sneaked into a percentage) is refused", async () => {
    origin();
    expect((await exec({ quotationId: QUOTE, percent: 10, lines: [{ rateItemId: "base", requestedRate: 1 }], reason })).status).toBe(400);
    expect((await exec({ quotationId: QUOTE, percent: 80, reason })).status).toBe(400);
    expect((await exec({ quotationId: QUOTE, lines: [{ rateItemId: "base", requestedRate: 90, ratePerUnit: 1 }], reason })).status).toBe(400);
    expect(db.quotation.create).not.toHaveBeenCalled();
  });

  it("cannot discount a quote that is closed", async () => {
    origin({ status: "accepted" });
    expect((await exec({ quotationId: QUOTE, percent: 5, reason })).status).toBe(409);
    expect(db.quotation.create).not.toHaveBeenCalled();
  });

  it("a repeat of the same approved discount returns the revision it already made", async () => {
    origin();
    const first = await exec({ quotationId: QUOTE, percent: 10, reason });
    const made = db.quotation.create.mock.results[0];
    const row = await made.value;
    db.quotation.findMany.mockResolvedValue([{ ...row, approvedByUserId: "boss" }]);
    db.quotation.create.mockClear();
    const again = await exec({ quotationId: QUOTE, percent: 10, reason });
    expect(db.quotation.create).not.toHaveBeenCalled();
    expect((again.body as any).deduplicated).toBe(true);
    expect(first.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("reads", () => {
  it("get_quote labels a draft clearly and an approved quote as approved", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow());
    const draft = await run(getQuote, undefined, { id: QUOTE });
    expect(draft.body.quotation).toMatchObject({ kind: "quotation", stage: "draft", approved: false, phoneLast4: "3210" });
    expect(draft.body.quotation.notice).toMatch(/DRAFT/);
    expect(draft.body.quotation.lines.find((l: any) => l.rateItemId === "base")).toMatchObject({ ratePerUnit: 100, amount: 500_000, included: true });
    expect(JSON.stringify(draft.body)).not.toContain(PHONE);
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "approved", approvedByUserId: "boss" }));
    const ok = await run(getQuote, undefined, { id: QUOTE });
    expect(ok.body.quotation).toMatchObject({ stage: "approved", approved: true, notice: null });
  });

  it("a malformed id is a 404 without touching the database", async () => {
    await expect(run(getQuote, undefined, { id: "not-an-id" })).rejects.toMatchObject({ status: 404 });
    expect(db.quotation.findUnique).not.toHaveBeenCalled();
  });

  it("get_quote_pdf gives a staff-only link, and the customer link only for an approved quote", async () => {
    db.quotation.findUnique.mockResolvedValue(quoteRow());
    const draft = await run(getQuotePdf, undefined, { id: QUOTE });
    expect(draft.body).toMatchObject({ pdfUrl: "https://blob.test/q.pdf", staffOnly: true, customerUrl: null });
    expect(JSON.stringify(draft.body)).not.toContain("/q/");
    expect(draft.body.notice).toMatch(/DRAFT/);
    db.quotation.findUnique.mockResolvedValue(quoteRow({ approvalState: "approved" }));
    const ok = await run(getQuotePdf, undefined, { id: QUOTE });
    expect(ok.body.customerUrl).toContain(`/q/${QUOTE}`);
    expect(ok.body.pdfUrl).toBe("https://blob.test/q.pdf");
  });

  it("list_quotes without a customer lists only the AI's own quotes; with a lead, that lead's", async () => {
    db.quotation.findMany.mockResolvedValue([]);
    await run(listQuotes, { limit: 20 });
    expect(db.quotation.findMany.mock.calls[0][0].where).toEqual({ agentOrigin: true });
    await run(listQuotes, { limit: 20, leadId: LEAD, status: "sent" });
    expect(db.quotation.findMany.mock.calls[1][0].where).toEqual({ accountContactId: LEAD, status: "sent" });
    await expect(run(listQuotes, { limit: 20, cursor: "garbage" })).rejects.toMatchObject({ status: 400 });
  });

  it("list_quotes pages with a cursor and returns summaries without line items", async () => {
    const rows = [quoteRow({ id: "r1" }), quoteRow({ id: "r2" }), quoteRow({ id: "r3" })];
    db.quotation.findMany.mockResolvedValue(rows);
    const res = await run(listQuotes, { limit: 2, leadId: LEAD });
    expect(res.body.items.map((i: any) => i.id)).toEqual(["r1", "r2"]);
    expect(res.body.nextCursor).toBe("r2");
    expect(res.body.items[0].lines).toBeUndefined();
  });

  it("invoices are read-only summaries with no address, phone or payment reference", async () => {
    const inv = {
      id: "inv-1", number: "Ravi.inv (Football)", quotationId: QUOTE, customerName: "Ravi", sport: "football", status: "partially_paid",
      grandTotal: 1000, amountPaid: 400, invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-15"), paidAt: null,
      contactPhone: PHONE, subtotal: 900, gstAmount: 100, lineItems: JSON.stringify(priced().lines),
      payments: [{ amount: 400, paidAt: new Date("2026-10-02"), method: "upi" }],
    };
    db.invoice.findUnique.mockResolvedValue(inv);
    const one = await run(getInvoice, undefined, { id: OTHER });
    expect(one.body.invoice).toMatchObject({ total: 1000, amountPaid: 400, balance: 600, phoneLast4: "3210" });
    expect(JSON.stringify(one.body)).not.toContain(PHONE);
    expect(db.invoice.findUnique.mock.calls[0][0].select.payments.select).toEqual({ amount: true, paidAt: true, method: true });
    expect(db.invoice.findUnique.mock.calls[0][0].select.billingAddress).toBeUndefined();

    db.invoice.findMany.mockResolvedValue([inv]);
    await run(listInvoices, { limit: 20, leadId: LEAD });
    expect(db.invoice.findMany.mock.calls[0][0].where).toEqual({ quotation: { accountContactId: LEAD } });
    db.invoice.findUnique.mockResolvedValue(null);
    await expect(run(getInvoice, undefined, { id: OTHER })).rejects.toMatchObject({ status: 404 });
  });
});
