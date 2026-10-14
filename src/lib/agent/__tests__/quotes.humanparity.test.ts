import { beforeEach, describe, expect, it, vi } from "vitest";

// The quotation logic extracted into src/lib/quotation/service.ts must behave
// exactly as it did inline in the human routes. These pin the human-facing
// outputs: what the routes answer and which rows they write.
const db = vi.hoisted(() => ({
  quotation: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  deal: { update: vi.fn(), findUnique: vi.fn() },
  account: { update: vi.fn() },
  conversation: { update: vi.fn() },
  dealLineItem: { createMany: vi.fn(), deleteMany: vi.fn() },
  sport: { findUnique: vi.fn() },
  message: { create: vi.fn() },
  accountContact: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const ext = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveContactForDocument: vi.fn(),
  applyDocumentClassification: vi.fn(),
  scheduleQuoteFollowUp: vi.fn(),
  ensureQuotationPdf: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  resolveWhatsAppDelivery: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: ext.getCurrentUser }));
vi.mock("@/lib/scout/after", () => ({ after: (w: unknown) => (typeof w === "function" ? (w as () => unknown)() : w) }));
vi.mock("@/lib/crm/contactLinks", () => ({
  resolveContactForDocument: ext.resolveContactForDocument,
  applyDocumentClassification: ext.applyDocumentClassification,
  scheduleQuoteFollowUp: ext.scheduleQuoteFollowUp,
  logDocumentDeleted: vi.fn(),
}));
vi.mock("@/lib/crm/deals", () => ({ reconcileDealAfterQuotationDelete: vi.fn() }));
vi.mock("@/lib/quotation/pdf-cache", () => ({
  ensureQuotationPdf: ext.ensureQuotationPdf,
  quotationFileName: (q: { number: string }) => `${q.number}.pdf`,
}));
vi.mock("@/lib/whatsapp", () => ({
  sendText: ext.sendText,
  sendMedia: ext.sendMedia,
  describeMetaError: (e: { code?: string; message?: string }) => ({ code: e?.code ?? "x", message: e?.message ?? "boom" }),
}));
vi.mock("@/lib/whatsapp-delivery", () => ({ resolveWhatsAppDelivery: ext.resolveWhatsAppDelivery }));

import { NextRequest } from "next/server";
import {
  APPROVAL_RESET,
  createQuotationWithNumber,
  editsQuoteContent,
  isRecentlySent,
  markQuotationSent,
  nextSequenceForYear,
  quoteCaptionText,
  RESEND_CONFIRM_MS,
  setDealQuotedValue,
  whatsAppWebHandoff,
  writeDealLineItems,
} from "@/lib/quotation/service";

const USER = { id: "rep-1", role: "sales", name: "Rep" };
const lineItem = (over: Record<string, unknown> = {}) => ({
  id: "turf", name: "Turf", description: "d", areaSqFt: 100, ratePerSqFt: 50, gstPercent: 18, total: 5000, included: true, ...over,
});
const req = (method: string, url: string, body?: unknown) =>
  new NextRequest(`https://app.test${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  ext.getCurrentUser.mockResolvedValue(USER);
  ext.resolveContactForDocument.mockResolvedValue({ id: "contact-1", explicit: true, canView: true, canEdit: true });
  ext.ensureQuotationPdf.mockResolvedValue({ url: "https://blob.test/q.pdf", key: "k" });
  ext.sendText.mockResolvedValue({ waMessageId: "wamid.text" });
  ext.sendMedia.mockResolvedValue({ waMessageId: "wamid.doc" });
  db.quotation.findFirst.mockResolvedValue({ number: "FIT-QT-2026-041" });
  db.quotation.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "q-1",
    status: "draft",
    grandTotal: data.grandTotal,
    ...data,
  }));
  db.quotation.updateMany.mockResolvedValue({ count: 1 });
  db.quotation.update.mockResolvedValue({ grandTotal: 5900, status: "draft" });
  db.deal.update.mockResolvedValue({ conversationId: null, wonValue: null, quotedValue: 5900 });
  db.sport.findUnique.mockResolvedValue({ id: "sp-1" });
  db.message.create.mockResolvedValue({});
  db.conversation.update.mockResolvedValue({});
});

describe("POST /api/quotations (human create)", () => {
  const body = {
    customerName: "Ravi",
    sport: "football",
    lengthFt: 10,
    widthFt: 10,
    lineItems: [lineItem()],
    quoteDate: "2026-10-13T00:00:00.000Z",
    contactPhone: "919876543210",
  };

  it("saves a plain draft exactly as before: next number, the client's lines, totals from recompute, no approval or agent fields", async () => {
    const { POST } = await import("@/app/api/quotations/route");
    const res = await POST(req("POST", "/api/quotations", body));
    expect(await res.json()).toEqual({ quotation: { id: "q-1", number: "FIT-QT-2026-042", status: "draft", grandTotal: "5900" } });
    const data = db.quotation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      number: "FIT-QT-2026-042",
      customerName: "Ravi",
      subtotal: 5000,
      gstAmount: 900,
      grandTotal: 5900,
      status: "draft",
      isPrimary: true,
      createdByUserId: "rep-1",
      accountContactId: "contact-1",
      dealId: null,
      validityDays: 30,
    });
    expect(data).not.toHaveProperty("approvalState");
    expect(data).not.toHaveProperty("agentOrigin");
    expect(db.deal.update).not.toHaveBeenCalled();
    expect(db.dealLineItem.createMany).not.toHaveBeenCalled();
  });

  it("on a deal: sets the quoted value, demotes the old primary quote and writes the DealLineItems", async () => {
    const { POST } = await import("@/app/api/quotations/route");
    const dealId = "55555555-5555-4555-8555-555555555555";
    await POST(req("POST", "/api/quotations", { ...body, dealId, siteCity: "Salem" }));
    expect(db.deal.update).toHaveBeenCalledWith({ where: { id: dealId }, data: { quotedValue: 5900, siteCity: "Salem" } });
    expect(db.quotation.updateMany).toHaveBeenCalledWith({ where: { dealId, isPrimary: true }, data: { isPrimary: false } });
    expect(db.dealLineItem.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ dealId, quotationId: "q-1", label: "Turf", quantity: 100, rate: 50, amount: 5000, sportId: "sp-1" }),
    ]);
  });

  it("a number collision takes the next number; six collisions in a row answer 503", async () => {
    const { POST } = await import("@/app/api/quotations/route");
    db.quotation.create
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }))
      .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ id: "q-1", status: "draft", ...data }));
    const ok = await POST(req("POST", "/api/quotations", body));
    expect(ok.status).toBe(200);
    expect(db.quotation.create.mock.calls.map((c) => c[0].data.number)).toEqual(["FIT-QT-2026-042", "FIT-QT-2026-043"]);

    db.quotation.create.mockReset();
    db.quotation.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req("POST", "/api/quotations", body));
    expect(res.status).toBe(503);
    expect(db.quotation.create).toHaveBeenCalledTimes(6);
  });

  it("refuses without a login, and a customer the user may not edit, as before", async () => {
    const { POST } = await import("@/app/api/quotations/route");
    ext.getCurrentUser.mockResolvedValueOnce(null);
    expect((await POST(req("POST", "/api/quotations", body))).status).toBe(401);
    ext.resolveContactForDocument.mockResolvedValueOnce({ id: "c", explicit: true, canView: true, canEdit: false });
    expect((await POST(req("POST", "/api/quotations", body))).status).toBe(403);
    expect(db.quotation.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/quotations/[id]/send (human send)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "q-1", number: "FIT-QT-2026-042", customerName: "Ravi", caption: null, contactPhone: "919876543210", grandTotal: 118000,
    createdByUserId: "rep-1", sentAt: null, conversationId: null, accountContactId: "contact-1", status: "draft", ...over,
  });
  const send = async (body: unknown = {}) => {
    const { POST } = await import("@/app/api/quotations/[id]/send/route");
    return POST(req("POST", "/api/quotations/q-1/send", body), { params: { id: "q-1" } });
  };

  it("inside the 24 h window: caption, then the PDF, marks sent, follows up, mirrors to the inbox", async () => {
    db.quotation.findUnique.mockResolvedValue(row());
    ext.resolveWhatsAppDelivery.mockResolvedValue({ mode: "cloud-api", conversationId: "convo-1", normalizedPhone: "919876543210" });
    const res = await send();
    expect(await res.json()).toEqual({ ok: true, pdfUrl: "https://blob.test/q.pdf", waMessageId: "wamid.doc" });
    expect(ext.sendText).toHaveBeenCalledWith({ to: "919876543210", body: "Quotation FIT-QT-2026-042 from Fitoverse — total ₹1,18,000" });
    expect(ext.sendMedia).toHaveBeenCalledWith({ to: "919876543210", mediaType: "document", url: "https://blob.test/q.pdf", filename: "FIT-QT-2026-042.pdf" });
    expect(db.quotation.updateMany).toHaveBeenCalledWith({ where: { id: "q-1", status: "draft" }, data: { status: "sent" } });
    expect(db.quotation.update).toHaveBeenCalledWith({ where: { id: "q-1" }, data: { pdfUrl: "https://blob.test/q.pdf", status: "sent", sentAt: expect.any(Date) } });
    expect(ext.scheduleQuoteFollowUp).toHaveBeenCalledWith({ quotationNumber: "FIT-QT-2026-042", accountContactId: "contact-1", conversationId: "convo-1", actorUserId: "rep-1" });
    expect(db.message.create).toHaveBeenCalledTimes(2);
    expect(db.message.create.mock.calls.every((c) => c[0].data.sentByUserId === "rep-1" && c[0].data.conversationId === "convo-1")).toBe(true);
    expect(db.conversation.update).toHaveBeenCalledWith({ where: { id: "convo-1" }, data: { lastOutboundAt: expect.any(Date) } });
  });

  it("outside the window: a WhatsApp Web link, marks sent, nothing goes through the Cloud API", async () => {
    db.quotation.findUnique.mockResolvedValue(row());
    ext.resolveWhatsAppDelivery.mockResolvedValue({ mode: "whatsapp-web", conversationId: null, normalizedPhone: "919876543210" });
    const body = await (await send()).json();
    expect(body).toMatchObject({ ok: true, pdfUrl: "https://blob.test/q.pdf", waMessageId: null });
    expect(body.whatsappWebUrl).toMatch(/^https:\/\/api\.whatsapp\.com\/send\/\?phone=919876543210&text=/);
    expect(decodeURIComponent(body.whatsappWebUrl)).toContain("/q/q-1");
    expect(ext.sendText).not.toHaveBeenCalled();
    expect(ext.sendMedia).not.toHaveBeenCalled();
    expect(db.quotation.update).toHaveBeenCalledWith({ where: { id: "q-1" }, data: expect.objectContaining({ status: "sent" }) });
    expect(ext.scheduleQuoteFollowUp).toHaveBeenCalledTimes(1);
  });

  it("the resend guard still answers 409 recently_sent unless the user confirmed", async () => {
    const sentAt = new Date(Date.now() - 60_000);
    db.quotation.findUnique.mockResolvedValue(row({ sentAt }));
    ext.resolveWhatsAppDelivery.mockResolvedValue({ mode: "cloud-api", conversationId: null, normalizedPhone: "919876543210" });
    const blocked = await send();
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "recently_sent", sentAt: sentAt.toISOString() });
    expect(ext.sendMedia).not.toHaveBeenCalled();
    expect((await send({ confirmResend: true })).status).toBe(200);
  });

  it("a WhatsApp failure is a 502 with the code, and the quote is not marked sent", async () => {
    db.quotation.findUnique.mockResolvedValue(row());
    ext.resolveWhatsAppDelivery.mockResolvedValue({ mode: "cloud-api", conversationId: null, normalizedPhone: "919876543210" });
    ext.sendMedia.mockRejectedValue({ code: "131047", message: "Re-engagement message" });
    const res = await send();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "WhatsApp send failed: Re-engagement message", code: "131047" });
    expect(db.quotation.update).not.toHaveBeenCalled();
  });

  it("no phone is 422; someone else's quote is 403; a missing quote is 404", async () => {
    db.quotation.findUnique.mockResolvedValue(row({ contactPhone: null }));
    expect((await send()).status).toBe(422);
    db.quotation.findUnique.mockResolvedValue(row({ createdByUserId: "someone-else" }));
    expect((await send()).status).toBe(403);
    db.quotation.findUnique.mockResolvedValue(null);
    expect((await send()).status).toBe(404);
  });
});

describe("PATCH /api/quotations/[id] (human edit)", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: "q-1", createdByUserId: "rep-1", status: "draft", dealId: null, isPrimary: true, approvalState: "none", sport: "football", ...over,
  });
  const patch = async (body: unknown) => {
    const { PATCH } = await import("@/app/api/quotations/[id]/route");
    return PATCH(req("PATCH", "/api/quotations/q-1", body), { params: { id: "q-1" } });
  };

  it("a normal edit writes exactly what it wrote before (no approval columns)", async () => {
    db.quotation.findUnique.mockResolvedValue(stored());
    const res = await patch({ notes: "Updated", validityDays: 20 });
    expect(await res.json()).toEqual({ ok: true, status: "draft" });
    expect(db.quotation.update).toHaveBeenCalledWith({ where: { id: "q-1" }, data: { notes: "Updated", validityDays: 20 } });
  });

  it("changing what an APPROVED quote says withdraws the approval", async () => {
    db.quotation.findUnique.mockResolvedValue(stored({ approvalState: "approved" }));
    await patch({ lineItems: [lineItem({ ratePerSqFt: 10, total: 1000 })] });
    expect(db.quotation.update.mock.calls[0][0].data).toMatchObject({ approvalState: "none", approvedByUserId: null, approvedAt: null });
  });

  it("a status-only change on an approved quote keeps the approval", async () => {
    db.quotation.findUnique.mockResolvedValue(stored({ approvalState: "approved", status: "sent" }));
    await patch({ status: "accepted" });
    expect(db.quotation.update.mock.calls[0][0].data).toEqual({ status: "accepted" });
  });
});

describe("lib/quotation/service", () => {
  it("nextSequenceForYear: 1 when none, else highest + 1, 1 when the number is unreadable", async () => {
    db.quotation.findFirst.mockResolvedValueOnce(null);
    expect(await nextSequenceForYear(2026)).toBe(1);
    db.quotation.findFirst.mockResolvedValueOnce({ number: "FIT-QT-2026-009" });
    expect(await nextSequenceForYear(2026)).toBe(10);
    db.quotation.findFirst.mockResolvedValueOnce({ number: "FIT-QT-2026-xyz" });
    expect(await nextSequenceForYear(2026)).toBe(1);
    expect(db.quotation.findFirst).toHaveBeenLastCalledWith({
      where: { number: { startsWith: "FIT-QT-2026-" } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
  });

  it("createQuotationWithNumber does not retry anything but a unique-number collision", async () => {
    db.quotation.create.mockReset();
    db.quotation.create.mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));
    await expect(createQuotationWithNumber({ year: 2026, nextSeq: 5, data: {} as never })).rejects.toThrow("fk");
    expect(db.quotation.create).toHaveBeenCalledTimes(1);
  });

  it("the resend window is 10 minutes", () => {
    expect(RESEND_CONFIRM_MS).toBe(600_000);
    expect(isRecentlySent(null)).toBe(false);
    expect(isRecentlySent(new Date(Date.now() - 599_000))).toBe(true);
    expect(isRecentlySent(new Date(Date.now() - 601_000))).toBe(false);
  });

  it("setDealQuotedValue changes only the fields given, and never throws", async () => {
    await setDealQuotedValue({ dealId: "d", quotedValue: 10, leadSourceId: "src" });
    expect(db.deal.update).toHaveBeenCalledWith({ where: { id: "d" }, data: { quotedValue: 10, leadSourceId: "src" } });
    db.deal.update.mockRejectedValueOnce(new Error("gone"));
    expect(await setDealQuotedValue({ dealId: "d", quotedValue: 10 })).toBeNull();
  });

  it("writeDealLineItems writes only included lines, can replace the old rows, and never throws", async () => {
    await writeDealLineItems({ dealId: "d", quotationId: "q", sport: "football", lineItems: [lineItem(), lineItem({ id: "x", included: false })], replaceExisting: true });
    expect(db.dealLineItem.deleteMany).toHaveBeenCalledWith({ where: { quotationId: "q" } });
    expect(db.dealLineItem.createMany.mock.calls[0][0].data).toHaveLength(1);
    db.dealLineItem.createMany.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(writeDealLineItems({ dealId: "d", quotationId: "q", sport: "football", lineItems: [lineItem()] })).resolves.toBeUndefined();
  });

  it("markQuotationSent schedules the follow-up on the first send only, and not when told not to", async () => {
    const q = { id: "q", number: "N", accountContactId: "c" };
    await markQuotationSent({ quotation: q, pdfUrl: "u", actorUserId: "a", followUpConversationId: null });
    expect(ext.scheduleQuoteFollowUp).toHaveBeenCalledTimes(1);
    db.quotation.updateMany.mockResolvedValueOnce({ count: 0 });
    await markQuotationSent({ quotation: q, pdfUrl: "u", actorUserId: "a", followUpConversationId: null });
    expect(ext.scheduleQuoteFollowUp).toHaveBeenCalledTimes(1);
    await markQuotationSent({ quotation: q, pdfUrl: "u", actorUserId: "a", followUpConversationId: null, scheduleFollowUp: false });
    expect(ext.scheduleQuoteFollowUp).toHaveBeenCalledTimes(1);
  });

  it("caption and WhatsApp Web text keep their wording", () => {
    expect(quoteCaptionText({ number: "N-1", caption: "  Hello  ", grandTotal: 5 })).toBe("Hello");
    expect(quoteCaptionText({ number: "N-1", caption: null, grandTotal: 1234567 })).toBe("Quotation N-1 from Fitoverse — total ₹12,34,567");
    const { whatsappWebUrl } = whatsAppWebHandoff({ id: "q1", number: "N-1", caption: null, grandTotal: 10, contactPhone: "+91 98765 43210" }, { normalizedPhone: null });
    expect(whatsappWebUrl).toContain("phone=919876543210");
  });

  it("only edits that change what the customer sees withdraw an approval", () => {
    expect(editsQuoteContent({ notes: "x" })).toBe(true);
    expect(editsQuoteContent({ lineItems: [] })).toBe(true);
    expect(editsQuoteContent({})).toBe(false);
    expect(APPROVAL_RESET).toEqual({ approvalState: "none", approvedByUserId: null, approvedAt: null });
  });
});
