import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  quotation: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  accountContact: { findUnique: vi.fn() },
  conversation: { findUnique: vi.fn() },
  setting: { findUnique: vi.fn() },
  optOut: { findFirst: vi.fn() },
  agentApprovalRequest: { findFirst: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));
const wa = vi.hoisted(() => ({ sendText: vi.fn(), sendMedia: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({
  sendText: (...a: unknown[]) => wa.sendText(...a),
  sendMedia: (...a: unknown[]) => wa.sendMedia(...a),
  isMetaConfigured: async () => true,
  describeMetaError: () => ({ code: "x", message: "boom" }),
}));
vi.mock("@/lib/quotation/pdf-cache", () => ({
  ensureQuotationPdf: vi.fn().mockResolvedValue({ url: "https://blob.test/q.pdf", key: "k" }),
  quotationFileName: () => "q.pdf",
}));
vi.mock("@/lib/whatsapp-delivery", () => ({ resolveWhatsAppDelivery: vi.fn() }));
const verifyCredential = vi.hoisted(() => vi.fn());
vi.mock("../keys", () => ({ verifyCredential: (...a: unknown[]) => verifyCredential(...a) }));
const writeAgentAudit = vi.hoisted(() => vi.fn());
vi.mock("../audit", () => ({ writeAgentAudit: (...a: unknown[]) => writeAgentAudit(...a) }));
const checkRateLimit = vi.hoisted(() => vi.fn());
vi.mock("../ratelimit", async () => {
  const actual = await vi.importActual<typeof import("../ratelimit")>("../ratelimit");
  return { ...actual, checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) };
});
const beginIdempotent = vi.hoisted(() => vi.fn());
const completeIdempotent = vi.hoisted(() => vi.fn());
vi.mock("../idempotency", async () => {
  const actual = await vi.importActual<typeof import("../idempotency")>("../idempotency");
  return {
    ...actual,
    beginIdempotent: (...a: unknown[]) => beginIdempotent(...a),
    completeIdempotent: (...a: unknown[]) => completeIdempotent(...a),
    failIdempotent: vi.fn(),
  };
});
const requestApproval = vi.hoisted(() => vi.fn());
vi.mock("../approvals", () => ({ requestApproval: (...a: unknown[]) => requestApproval(...a) }));

import { AGENT_ROUTES, buildOpenApi } from "../openapi";
import { effectiveTable, effectiveVerdict, TOOL_REGISTRY } from "../permissions";
import { AREA_EXECUTORS } from "../registry";
import * as deals from "../registry/deals";
import * as documents from "../registry/documents";
import * as leads from "../registry/leads";
import * as messaging from "../registry/messaging";
import * as read from "../registry/read";
import { EXECUTORS, ROUTES, TOOLS } from "../registry/quotes";

const ROOT = path.resolve(__dirname, "../../../..");
const QUOTE = "11111111-1111-4111-8111-111111111111";
const LEAD = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const NEVER = ["approve_quote", "edit_quote_terms", "convert_to_invoice", "record_payment", "set_rate"];

describe("quotes registry", () => {
  it("registers every tool with the agreed default verdict", () => {
    const want: Record<string, string> = {
      create_draft_quote: "ALLOWED",
      get_quote: "ALLOWED",
      list_quotes: "ALLOWED",
      update_draft_quote: "ALLOWED",
      revise_quote: "ALLOWED",
      get_quote_pdf: "ALLOWED",
      quote_history: "ALLOWED",
      submit_quote_for_approval: "ALLOWED",
      request_discount: "APPROVAL",
      send_quote: "ALLOWED",
      list_quote_templates: "ALLOWED",
      list_invoices: "ALLOWED",
      get_invoice: "ALLOWED",
      approve_quote: "NEVER",
      edit_quote_terms: "NEVER",
      convert_to_invoice: "NEVER",
      record_payment: "NEVER",
      set_rate: "NEVER",
    };
    expect(Object.keys(TOOLS).sort()).toEqual(Object.keys(want).sort());
    const table = effectiveTable({});
    for (const [tool, verdict] of Object.entries(want)) expect(table[tool], tool).toBe(verdict);
  });

  it("does not collide with another stage's tool names", () => {
    const others = [read, leads, messaging, deals, documents].flatMap((a) => Object.keys(a.TOOLS));
    expect(Object.keys(TOOLS).filter((t) => others.includes(t))).toEqual([]);
  });

  it("classifies actions so the right rate-limit group applies", () => {
    for (const t of ["get_quote", "list_quotes", "get_quote_pdf", "quote_history", "list_quote_templates", "list_invoices", "get_invoice"]) {
      expect(TOOLS[t].action, t).toBe("read");
    }
    expect(TOOLS.send_quote.action).toBe("send");
    expect(TOOLS.create_draft_quote.action).toBe("create");
    expect(TOOLS.update_draft_quote.action).toBe("update");
  });

  it("the NEVER tools cannot be loosened and have no route", () => {
    for (const t of NEVER) {
      expect(TOOLS[t], t).toMatchObject({ default: "NEVER", neverLoosen: true });
      expect(effectiveVerdict(t, { [t]: "ALLOWED" }), t).toBe("NEVER");
      expect(effectiveVerdict(t, { [t]: "APPROVAL" }), t).toBe("NEVER");
      expect(ROUTES.some((r) => r.tool === t), t).toBe(false);
      expect(TOOL_REGISTRY[t]).toBeDefined();
    }
  });

  it("request_discount can only get stricter, never run without a person", () => {
    expect(TOOLS.request_discount).toMatchObject({ default: "APPROVAL", neverLoosen: true });
    expect(effectiveVerdict("request_discount", { request_discount: "ALLOWED" })).toBe("APPROVAL");
    expect(effectiveVerdict("request_discount", { request_discount: "NEVER" })).toBe("NEVER");
  });

  it("there is no tool that sets a rate, a price or a total", () => {
    for (const name of Object.keys(TOOLS).filter((t) => !NEVER.includes(t))) {
      expect(name, name).not.toMatch(/set_rate|set_price|set_total|override|edit_terms|record_payment|convert/);
    }
    expect(Object.keys(TOOLS).filter((t) => /rate|price/.test(t))).toEqual(["set_rate"]);
  });

  it("runs the human decisions: approve_quote and request_discount have executors, and the registry exposes them", () => {
    expect(Object.keys(EXECUTORS).sort()).toEqual(["approve_quote", "request_discount"]);
    expect(AREA_EXECUTORS.approve_quote).toBe(EXECUTORS.approve_quote);
    expect(AREA_EXECUTORS.request_discount).toBe(EXECUTORS.request_discount);
  });

  it("every route points at a registered tool and has a route.ts that wraps that tool in withAgent", () => {
    for (const r of ROUTES) {
      expect(TOOLS[r.tool!], r.path).toBeDefined();
      const file = path.join(ROOT, "src/app/api/agent/v1", r.path.replace(/\{id\}/g, "[id]"), "route.ts");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8"), file).toContain(`withAgent("${r.tool}"`);
    }
    expect(new Set(ROUTES.map((r) => r.tool))).toEqual(new Set(Object.keys(TOOLS).filter((t) => !NEVER.includes(t))));
  });

  it("is published in the OpenAPI document without leaking internals", () => {
    expect(AGENT_ROUTES.length).toBeGreaterThanOrEqual(ROUTES.length);
    const doc = buildOpenApi() as unknown as {
      paths: Record<string, Record<string, { "x-tool": string; "x-default-verdict": string; parameters: { name: string }[]; requestBody?: { content: Record<string, { schema: any }> } }>>;
    };
    expect(doc.paths["/quotations"].post["x-tool"]).toBe("create_draft_quote");
    expect(doc.paths["/quotations"].get["x-tool"]).toBe("list_quotes");
    expect(doc.paths["/quotations/{id}/send"].post["x-tool"]).toBe("send_quote");
    expect(doc.paths["/quotations/{id}/discount-requests"].post["x-default-verdict"]).toBe("APPROVAL");
    expect(doc.paths["/quotations/{id}"].patch["x-tool"]).toBe("update_draft_quote");
    expect(doc.paths["/invoices/{id}"].get["x-tool"]).toBe("get_invoice");
    expect(doc.paths["/quotations"].post.parameters.map((p) => p.name)).toContain("Idempotency-Key");
    expect(doc.paths["/quotations"].get.parameters.map((p) => p.name)).not.toContain("Idempotency-Key");
    // the published create body has no field for a rate, price, total or GST
    const create = doc.paths["/quotations"].post.requestBody!.content["application/json"].schema;
    expect(create.additionalProperties).toBe(false);
    expect(Object.keys(create.properties).sort()).toEqual(
      ["conversationId", "dealId", "items", "leadId", "lengthFt", "notes", "sport", "validityDays", "widthFt"].sort(),
    );
    expect(Object.keys(create.properties.items.items.properties).sort()).toEqual(["included", "quantity", "rateItemId"]);
    expect(create.properties.sport.enum).toContain("football");
    const json = JSON.stringify(doc).toLowerCase();
    expect(json).not.toContain("database");
    expect(json).not.toMatch(/fvai_(dev|stg|prd)_[a-f0-9]{16}_/);
  });
});

describe("through the real routes and withAgent", () => {
  const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = { "idempotency-key": "idem-key-0001" }) =>
    new Request(`https://app.test${url}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const lastAudit = () => writeAgentAudit.mock.calls.at(-1)![0] as Record<string, unknown>;
  const draftRow = {
    id: QUOTE, number: "FIT-QT-2026-001", customerName: "Ravi", sport: "football", lengthFt: 10, widthFt: 10, lineItems: "[]",
    subtotal: 0, gstAmount: 0, grandTotal: 0, notes: null, status: "draft", approvalState: "none", agentOrigin: true, version: 1,
    quoteDate: new Date(), validityDays: 30, sentAt: null, conversationId: null, contactPhone: "919876543210", dealId: null,
    accountContactId: LEAD, parentQuotationId: null, approvedByUserId: null, approvedAt: null, createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    verifyCredential.mockResolvedValue({
      ok: true,
      context: { identityId: "idn-1", userId: "agent-user", credentialId: "cred-1", environment: "staging", ip: null },
      meta: { identityName: "Agent", credentialLabel: "l", keyPrefix: "fvai_stg_x", expiresAt: null },
    });
    writeAgentAudit.mockResolvedValue({});
    checkRateLimit.mockResolvedValue({ allowed: true });
    beginIdempotent.mockResolvedValue({ kind: "execute" });
    db.setting.findUnique.mockResolvedValue(null);
    db.quotation.findUnique.mockResolvedValue(draftRow);
    requestApproval.mockResolvedValue({ approvalId: "appr-9", created: true });
  });

  it("a rate in the request is a 400 and nothing is saved", async () => {
    const { POST } = await import("@/app/api/agent/v1/quotations/route");
    for (const extra of [{ rate: 90 }, { total: 1 }, { items: [{ rateItemId: "turf", ratePerUnit: 1 }] }]) {
      const res = await POST(call("POST", "/api/agent/v1/quotations", { leadId: LEAD, sport: "football", lengthFt: 100, widthFt: 50, ...extra }));
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_input");
    }
    expect(db.quotation.create).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "invalid", httpStatus: 400, toolName: "create_draft_quote" });
  });

  it("creating needs an Idempotency-Key", async () => {
    const { POST } = await import("@/app/api/agent/v1/quotations/route");
    const res = await POST(call("POST", "/api/agent/v1/quotations", { leadId: LEAD, sport: "football", lengthFt: 10, widthFt: 10 }, {}));
    expect(res.status).toBe(400);
    expect(db.quotation.create).not.toHaveBeenCalled();
  });

  it("send_quote on a draft is 403 quote_not_approved, audited as denied, and sends nothing", async () => {
    const { POST } = await import("@/app/api/agent/v1/quotations/[id]/send/route");
    const res = await POST(call("POST", `/api/agent/v1/quotations/${QUOTE}/send`, {}), { params: { id: QUOTE } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "quote_not_approved", message: expect.stringContaining("submit_quote_for_approval"), correlationId: expect.any(String) },
    });
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(wa.sendMedia).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "denied", httpStatus: 403, action: "refused:quote_not_approved", recordIds: [QUOTE] });
    // stored for replay like any 4xx
    expect(completeIdempotent).toHaveBeenCalledWith("idn-1", "idem-key-0001", 403, expect.anything());
  });

  it("send_quote refuses a recipient or caption in the body", async () => {
    const { POST } = await import("@/app/api/agent/v1/quotations/[id]/send/route");
    for (const extra of [{ to: "919999999999" }, { caption: "Special offer" }, { text: "hi" }]) {
      const res = await POST(call("POST", `/api/agent/v1/quotations/${QUOTE}/send`, extra), { params: { id: QUOTE } });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(wa.sendMedia).not.toHaveBeenCalled();
  });

  it("request_discount is queued for a person by withAgent, with the quotation id from the path, and nothing else happens", async () => {
    const { POST } = await import("@/app/api/agent/v1/quotations/[id]/discount-requests/route");
    const res = await POST(
      call("POST", `/api/agent/v1/quotations/${QUOTE}/discount-requests`, { percent: 5, reason: "Two courts ordered" }),
      { params: { id: QUOTE } },
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ approvalId: "appr-9", status: "pending" });
    expect(requestApproval.mock.calls[0][0]).toMatchObject({
      toolName: "request_discount",
      input: { quotationId: QUOTE, percent: 5, reason: "Two courts ordered" },
    });
    expect(db.quotation.findUnique).not.toHaveBeenCalled();
    expect(db.quotation.create).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "pending_approval", httpStatus: 202, toolName: "request_discount" });
  });

  it("request_discount rejects a request that is not a discount (no rate field on a percentage, both, neither, >50%)", async () => {
    const { POST } = await import("@/app/api/agent/v1/quotations/[id]/discount-requests/route");
    for (const body of [
      { percent: 5 },
      { percent: 80, reason: "Please" },
      { percent: 5, lines: [{ rateItemId: "a", requestedRate: 1 }], reason: "Please" },
      { reason: "Please" },
    ]) {
      const res = await POST(call("POST", `/api/agent/v1/quotations/${QUOTE}/discount-requests`, body), { params: { id: QUOTE } });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("get_quote shows a draft as not approved", async () => {
    const { GET } = await import("@/app/api/agent/v1/quotations/[id]/route");
    const res = await GET(call("GET", `/api/agent/v1/quotations/${QUOTE}`, undefined, {}), { params: { id: QUOTE } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quotation).toMatchObject({ approved: false, stage: "draft" });
    expect(lastAudit()).toMatchObject({ result: "success", toolName: "get_quote", action: "read" });
  });

  it("an admin who sets a NEVER tool to ALLOWED in settings changes nothing (no route exists to call anyway)", () => {
    for (const t of NEVER) expect(effectiveVerdict(t, { [t]: "ALLOWED" })).toBe("NEVER");
  });

  it("list_quote_templates returns the sport's default sections, read-only", async () => {
    const { GET } = await import("@/app/api/agent/v1/quotations/templates/route");
    const res = await GET(call("GET", "/api/agent/v1/quotations/templates?sport=football", undefined, {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sport: "football", kind: "template", editableByAgent: false });
    expect(body.sections.map((s: { type: string }) => s.type)).toEqual(expect.arrayContaining(["cover", "particulars", "totals", "terms"]));
    expect((await GET(call("GET", "/api/agent/v1/quotations/templates?sport=chess", undefined, {}))).status).toBe(400);
  });
});
