import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn(), update: vi.fn() },
  message: { findMany: vi.fn(), create: vi.fn() },
  optOut: { findFirst: vi.fn() },
  contact: { findFirst: vi.fn() },
  setting: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));
const wa = vi.hoisted(() => ({ sendText: vi.fn(), sendTemplate: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({
  sendText: (...a: unknown[]) => wa.sendText(...a),
  sendTemplate: (...a: unknown[]) => wa.sendTemplate(...a),
  isMetaConfigured: async () => true,
  describeMetaError: () => ({ code: "x", message: "boom" }),
}));
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
import { ROUTES, TOOLS } from "../registry/messaging";

const ROOT = path.resolve(__dirname, "../../../..");
const CONVO = "11111111-1111-4111-8111-111111111111";

describe("messaging registry", () => {
  it("registers every tool with the agreed default verdict", () => {
    const want: Record<string, string> = {
      list_conversations: "ALLOWED",
      get_messages: "ALLOWED",
      get_events: "ALLOWED",
      get_send_eligibility: "ALLOWED",
      list_templates: "ALLOWED",
      send_reply: "ALLOWED",
      send_template: "ALLOWED",
      send_marketing_template: "APPROVAL",
      record_opt_out: "ALLOWED",
      set_campaign_consent_false: "ALLOWED",
      resubscribe_contact: "NEVER",
    };
    expect(Object.keys(TOOLS).sort()).toEqual(Object.keys(want).sort());
    const table = effectiveTable({});
    for (const [tool, verdict] of Object.entries(want)) expect(table[tool], tool).toBe(verdict);
  });

  it("classifies actions so the right rate-limit group and idempotency rules apply", () => {
    for (const t of ["list_conversations", "get_messages", "get_events", "get_send_eligibility", "list_templates"]) {
      expect(TOOLS[t].action).toBe("read");
    }
    for (const t of ["send_reply", "send_template", "send_marketing_template"]) expect(TOOLS[t].action).toBe("send");
    for (const t of ["record_opt_out", "set_campaign_consent_false"]) expect(TOOLS[t].action).toBe("update");
  });

  it("resubscribe_contact is NEVER, cannot be loosened, and has no route", () => {
    expect(TOOLS.resubscribe_contact).toMatchObject({ default: "NEVER", neverLoosen: true });
    expect(effectiveVerdict("resubscribe_contact", { resubscribe_contact: "ALLOWED" })).toBe("NEVER");
    expect(ROUTES.some((r) => r.tool === "resubscribe_contact")).toBe(false);
    expect(TOOL_REGISTRY.resubscribe_contact).toBeDefined();
  });

  it("marketing sends can only ever get stricter", () => {
    expect(TOOLS.send_marketing_template.neverLoosen).toBe(true);
    expect(effectiveVerdict("send_marketing_template", { send_marketing_template: "ALLOWED" })).toBe("APPROVAL");
    expect(effectiveVerdict("send_marketing_template", { send_marketing_template: "NEVER" })).toBe("NEVER");
  });

  it("has no tool that re-subscribes, grants consent or deletes an opt-out", () => {
    // resubscribe_contact exists only as a NEVER row (asserted above); nothing else of that kind.
    for (const name of Object.keys(TOOLS).filter((t) => t !== "resubscribe_contact")) {
      expect(name).not.toMatch(/subscribe|grant|consent_true|delete_opt|remove_opt/);
    }
    expect(Object.keys(TOOLS).filter((t) => /subscribe/.test(t))).toEqual(["resubscribe_contact"]);
  });

  it("every route points at a registered tool and has a route.ts that wraps that tool in withAgent", () => {
    for (const r of ROUTES) {
      expect(TOOLS[r.tool!], r.path).toBeDefined();
      const file = path.join(ROOT, "src/app/api/agent/v1", r.path.replace(/\{id\}/g, "[id]"), "route.ts");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8"), file).toContain(`withAgent("${r.tool}"`);
    }
    // and every tool except the pinned one has a route
    expect(new Set(ROUTES.map((r) => r.tool))).toEqual(new Set(Object.keys(TOOLS).filter((t) => t !== "resubscribe_contact")));
  });

  it("is published in the OpenAPI document without leaking internals", () => {
    expect(AGENT_ROUTES.length).toBeGreaterThanOrEqual(ROUTES.length);
    const doc = buildOpenApi() as unknown as { paths: Record<string, Record<string, { "x-tool": string; parameters: { name: string }[] }>> };
    expect(doc.paths["/conversations/{id}/messages"].get["x-tool"]).toBe("get_messages");
    expect(doc.paths["/conversations/{id}/messages"].post["x-tool"]).toBe("send_reply");
    expect(doc.paths["/marketing-template-messages"].post["x-tool"]).toBe("send_marketing_template");
    expect(doc.paths["/conversations/{id}/messages"].post.parameters.map((p) => p.name)).toContain("Idempotency-Key");
    expect(doc.paths["/conversations"].get.parameters.map((p) => p.name)).not.toContain("Idempotency-Key");
    const json = JSON.stringify(doc).toLowerCase();
    expect(json).not.toContain("database");
    expect(json).not.toMatch(/fvai_(dev|stg|prd)_[a-f0-9]{16}_/);
  });
});

describe("through the real routes and withAgent", () => {
  const post = (url: string, body: unknown) =>
    new Request(`https://app.test${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-key-0001" },
      body: JSON.stringify(body),
    });
  const lastAudit = () => writeAgentAudit.mock.calls.at(-1)![0] as Record<string, unknown>;

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
    db.conversation.findUnique.mockResolvedValue({
      id: CONVO,
      contactPhone: "919876543210",
      lastInboundAt: new Date(Date.now() - 3_600_000),
    });
    db.optOut.findFirst.mockResolvedValue(null);
    db.contact.findFirst.mockResolvedValue(null);
    db.message.findMany.mockResolvedValue([]);
    requestApproval.mockResolvedValue({ approvalId: "appr-9", created: true });
  });

  it("send_marketing_template is queued for a human by withAgent and never reaches WhatsApp", async () => {
    const { POST } = await import("@/app/api/agent/v1/marketing-template-messages/route");
    const res = await POST(post("/api/agent/v1/marketing-template-messages", { conversationId: CONVO, templateId: "tpl-1", variables: ["a"] }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ approvalId: "appr-9", status: "pending" });
    // the stored input names the conversation, so the approver sees the whole request
    expect(requestApproval.mock.calls[0][0]).toMatchObject({
      toolName: "send_marketing_template",
      input: { conversationId: CONVO, templateId: "tpl-1", variables: ["a"] },
    });
    expect(wa.sendTemplate).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "pending_approval", httpStatus: 202, toolName: "send_marketing_template" });
  });

  it("an opted-out refusal reaches the caller with its own code and is audited as denied", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
    const { POST } = await import("@/app/api/agent/v1/conversations/[id]/messages/route");
    const res = await POST(post(`/api/agent/v1/conversations/${CONVO}/messages`, { text: "Hello" }), { params: { id: CONVO } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "opted_out", message: expect.any(String), correlationId: expect.any(String) },
    });
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "denied", httpStatus: 403, action: "refused:opted_out", recordIds: [CONVO] });
    // stored for replay like any 4xx
    expect(completeIdempotent).toHaveBeenCalledWith("idn-1", "idem-key-0001", 403, expect.anything());
  });

  it("a phone number in the body is a 400: the recipient always comes from the conversation", async () => {
    const { POST } = await import("@/app/api/agent/v1/conversations/[id]/messages/route");
    const res = await POST(post(`/api/agent/v1/conversations/${CONVO}/messages`, { text: "Hi", to: "919999999999" }), { params: { id: CONVO } });
    expect(res.status).toBe(400);
    expect(wa.sendText).not.toHaveBeenCalled();
    const oversize = await POST(post(`/api/agent/v1/conversations/${CONVO}/messages`, { text: "x".repeat(1001) }), { params: { id: CONVO } });
    expect(oversize.status).toBe(400);
  });

  it("a send without an Idempotency-Key is refused", async () => {
    const { POST } = await import("@/app/api/agent/v1/conversations/[id]/messages/route");
    const res = await POST(
      new Request("https://app.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hi" }) }),
      { params: { id: CONVO } },
    );
    expect(res.status).toBe(400);
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it("a held price message comes back 202 with the approvalId and the reason", async () => {
    const { POST } = await import("@/app/api/agent/v1/conversations/[id]/messages/route");
    const res = await POST(post(`/api/agent/v1/conversations/${CONVO}/messages`, { text: "It will be Rs 4,50,000" }), { params: { id: CONVO } });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ approvalId: "appr-9", status: "pending", reason: "needs_approval_price_or_commitment" });
    expect(lastAudit()).toMatchObject({ action: "approval_requested", httpStatus: 202 });
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it("reads need no Idempotency-Key and are not audited as changes", async () => {
    const { GET } = await import("@/app/api/agent/v1/conversations/[id]/eligibility/route");
    const res = await GET(new Request(`https://app.test/api/agent/v1/conversations/${CONVO}/eligibility`), { params: { id: CONVO } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ conversationId: CONVO, canReplyFreeText: true, allowCampaign: null });
    const opts = writeAgentAudit.mock.calls.at(-1)![1] as { mutating: boolean };
    expect(opts.mutating).toBe(false);
  });
});
