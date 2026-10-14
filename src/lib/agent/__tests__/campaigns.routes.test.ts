import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The stage-6 routes through the real route files and withAgent. */
const db = vi.hoisted(() => ({
  setting: { findUnique: vi.fn() },
  deal: { findUnique: vi.fn(), update: vi.fn() },
  template: { findUnique: vi.fn() },
  broadcast: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  contact: { findMany: vi.fn(), findFirst: vi.fn() },
  optOut: { findMany: vi.fn(), findFirst: vi.fn() },
  courtImage: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  conversation: { findUnique: vi.fn(), update: vi.fn() },
  message: { findMany: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));
const control = vi.hoisted(() => ({ startBroadcast: vi.fn(), requestBroadcastPause: vi.fn() }));
vi.mock("@/lib/broadcasts/control", () => control);
const wa = vi.hoisted(() => ({ sendText: vi.fn(), sendMedia: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({
  sendText: (...a: unknown[]) => wa.sendText(...a),
  sendMedia: (...a: unknown[]) => wa.sendMedia(...a),
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
vi.mock("../idempotency", async () => {
  const actual = await vi.importActual<typeof import("../idempotency")>("../idempotency");
  return { ...actual, beginIdempotent: (...a: unknown[]) => beginIdempotent(...a), completeIdempotent: vi.fn(), failIdempotent: vi.fn() };
});
const requestApproval = vi.hoisted(() => vi.fn());
vi.mock("../approvals", () => ({ requestApproval: (...a: unknown[]) => requestApproval(...a) }));

import { resetOverridesCache } from "../permissions";

const ROOT = path.resolve(__dirname, "../../../..");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DEAL = uuid(1);
const BC = uuid(2);
const TEMPLATE = uuid(3);
const DESIGN = uuid(4);
const LEAD = uuid(5);

const req = (method: string, url: string, body?: unknown) =>
  new Request(`https://app.test${url}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "idem-key-0001" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const lastAudit = () => writeAgentAudit.mock.calls.at(-1)![0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  resetOverridesCache();
  verifyCredential.mockResolvedValue({
    ok: true,
    context: { identityId: "idn-1", userId: "agent-user", credentialId: "cred-1", environment: "staging", ip: null },
    meta: { identityName: "Agent", credentialLabel: "l", keyPrefix: "fvai_stg_x", expiresAt: null },
  });
  writeAgentAudit.mockResolvedValue({});
  checkRateLimit.mockResolvedValue({ allowed: true });
  beginIdempotent.mockResolvedValue({ kind: "execute" });
  db.setting.findUnique.mockResolvedValue(null);
  requestApproval.mockResolvedValue({ approvalId: "appr-9", created: true });
});

describe("APPROVAL routes queue a request that carries the id from the URL", () => {
  const cases: Array<[string, () => Promise<Response>, string, Record<string, unknown>]> = [
    [
      "set_deal_execution_status",
      async () => (await import("@/app/api/agent/v1/deals/[id]/execution/route")).PATCH(req("PATCH", `/api/agent/v1/deals/${DEAL}/execution`, { status: "COMPLETED" }), { params: { id: DEAL } }),
      "set_deal_execution_status",
      { dealId: DEAL, status: "COMPLETED" },
    ],
    [
      "update_deal_won_value",
      async () => (await import("@/app/api/agent/v1/deals/[id]/won-value/route")).PATCH(req("PATCH", `/api/agent/v1/deals/${DEAL}/won-value`, { wonValue: 500000 }), { params: { id: DEAL } }),
      "update_deal_won_value",
      { dealId: DEAL, wonValue: 500000 },
    ],
    [
      "launch_broadcast",
      async () => (await import("@/app/api/agent/v1/broadcasts/[id]/launch/route")).POST(req("POST", `/api/agent/v1/broadcasts/${BC}/launch`, { note: "Festival" }), { params: { id: BC } }),
      "launch_broadcast",
      { broadcastId: BC, note: "Festival" },
    ],
    [
      "schedule_broadcast",
      async () => (await import("@/app/api/agent/v1/broadcasts/[id]/schedule/route")).POST(req("POST", `/api/agent/v1/broadcasts/${BC}/schedule`, { scheduledAt: "2026-12-01T10:00:00Z" }), { params: { id: BC } }),
      "schedule_broadcast",
      { broadcastId: BC, scheduledAt: "2026-12-01T10:00:00Z" },
    ],
  ];

  for (const [name, call, tool, stored] of cases) {
    it(`${name} is held for a human (202) and nothing runs`, async () => {
      const res = await call();
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ approvalId: "appr-9", status: "pending" });
      expect(requestApproval.mock.calls[0][0]).toMatchObject({ toolName: tool, input: stored });
      expect(lastAudit()).toMatchObject({ result: "pending_approval", httpStatus: 202, toolName: tool });
      expect(control.startBroadcast).not.toHaveBeenCalled();
      expect(db.deal.update).not.toHaveBeenCalled();
      expect(db.broadcast.updateMany).not.toHaveBeenCalled();
    });
  }

  it("an id in the body cannot override the URL's", async () => {
    const { POST } = await import("@/app/api/agent/v1/broadcasts/[id]/launch/route");
    // broadcastId is not an accepted body key, but the path wins anyway: the strict schema sees the URL's id
    const res = await POST(req("POST", `/api/agent/v1/broadcasts/${BC}/launch`, { broadcastId: uuid(99) }), { params: { id: BC } });
    expect(res.status).toBe(202);
    expect(requestApproval.mock.calls[0][0].input).toEqual({ broadcastId: BC });
  });

  it("a malformed body is a 400 and nothing is queued", async () => {
    const { PATCH } = await import("@/app/api/agent/v1/deals/[id]/won-value/route");
    const bad = await PATCH(req("PATCH", `/api/agent/v1/deals/${DEAL}/won-value`, { ownerUserId: uuid(7) }), { params: { id: DEAL } });
    expect(bad.status).toBe(400);
    const empty = await PATCH(req("PATCH", `/api/agent/v1/deals/${DEAL}/won-value`, {}), { params: { id: DEAL } });
    expect(empty.status).toBe(400);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("an admin override can make launch_broadcast NEVER, and nothing is queued", async () => {
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ launch_broadcast: "NEVER" }) });
    const { POST } = await import("@/app/api/agent/v1/broadcasts/[id]/launch/route");
    const res = await POST(req("POST", `/api/agent/v1/broadcasts/${BC}/launch`, {}), { params: { id: BC } });
    expect(res.status).toBe(403);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("an override cannot loosen launch_broadcast to ALLOWED", async () => {
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ launch_broadcast: "ALLOWED", schedule_broadcast: "ALLOWED" }) });
    const { POST } = await import("@/app/api/agent/v1/broadcasts/[id]/launch/route");
    const res = await POST(req("POST", `/api/agent/v1/broadcasts/${BC}/launch`, {}), { params: { id: BC } });
    expect(res.status).toBe(202);
  });
});

describe("ALLOWED campaign and design routes", () => {
  it("draft_broadcast runs and creates a draft, never a launch", async () => {
    db.template.findUnique.mockResolvedValue({ id: TEMPLATE, name: "t", category: "MARKETING", body: "Hi {{1}}", status: "approved", deletedAt: null });
    db.contact.findMany.mockResolvedValue([{ id: uuid(10), phone: "919876500010", allowCampaign: true }]);
    db.optOut.findMany.mockResolvedValue([]);
    db.broadcast.findMany.mockResolvedValue([]);
    db.broadcast.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: BC, ...data, scheduledAt: null }));
    const { POST } = await import("@/app/api/agent/v1/broadcasts/route");
    const res = await POST(req("POST", "/api/agent/v1/broadcasts", { name: "n", templateId: TEMPLATE, contactIds: [uuid(10)], variableMapping: { "1": "name" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ broadcast: { id: BC, status: "draft" }, eligibleRecipients: 1 });
    expect(lastAudit()).toMatchObject({ toolName: "draft_broadcast", result: "success", recordIds: [BC, TEMPLATE] });
    expect(control.startBroadcast).not.toHaveBeenCalled();
  });

  it("draft_broadcast refuses a file source with a 400", async () => {
    const { POST } = await import("@/app/api/agent/v1/broadcasts/route");
    for (const extra of [{ sourceType: "file", fileData: "x" }, { sheetUrl: "https://docs.google.com/spreadsheets/d/abc", sheetRange: "A:B" }]) {
      const res = await POST(req("POST", "/api/agent/v1/broadcasts", { name: "n", templateId: TEMPLATE, contactIds: [uuid(10)], variableMapping: {}, ...extra }));
      expect(res.status).toBe(400);
    }
    expect(db.broadcast.create).not.toHaveBeenCalled();
  });

  it("pause_broadcast stops a running broadcast", async () => {
    db.broadcast.findFirst.mockResolvedValue({ id: BC, status: "running" });
    control.requestBroadcastPause.mockResolvedValue({ ok: true, pauseRequestedAt: "x" });
    const { POST } = await import("@/app/api/agent/v1/broadcasts/[id]/pause/route");
    const res = await POST(req("POST", `/api/agent/v1/broadcasts/${BC}/pause`, {}), { params: { id: BC } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "pause_requested" });
  });

  it("get_broadcast_status needs no Idempotency-Key and is read-only", async () => {
    db.broadcast.findFirst.mockResolvedValue({
      id: BC, name: "n", status: "completed", total: 5, sent: 5, delivered: 4, read: 2, failed: 0,
      scheduledAt: null, launchedAt: null, completedAt: null, createdAt: new Date(), pauseRequestedAt: null, variableMapping: "{}",
    });
    const { GET } = await import("@/app/api/agent/v1/broadcasts/[id]/route");
    const res = await GET(new Request(`https://app.test/api/agent/v1/broadcasts/${BC}`), { params: { id: BC } });
    expect(res.status).toBe(200);
    expect(lastAudit()).toMatchObject({ toolName: "get_broadcast_status", action: "read" });
  });

  it("list_designs needs a customer; send_design refuses a phone number in the body", async () => {
    const list = await import("@/app/api/agent/v1/court-designs/route");
    expect((await list.GET(new Request("https://app.test/api/agent/v1/court-designs"))).status).toBe(400);
    expect(db.courtImage.findMany).not.toHaveBeenCalled();
    const sendRoute = await import("@/app/api/agent/v1/court-designs/[id]/send/route");
    const res = await sendRoute.POST(req("POST", `/api/agent/v1/court-designs/${DESIGN}/send`, { formats: ["2d"], to: "919999999999" }), { params: { id: DESIGN } });
    expect(res.status).toBe(400);
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(db.courtImage.findUnique).not.toHaveBeenCalled();
  });

  it("create_design_draft refuses a picture URL", async () => {
    const { POST } = await import("@/app/api/agent/v1/court-designs/route");
    const res = await POST(req("POST", "/api/agent/v1/court-designs", { leadId: LEAD, sport: "football", lengthFt: 100, widthFt: 60, image2dUrl: "https://x.test/a.png" }));
    expect(res.status).toBe(400);
  });

  it("send_design outside the window comes back as window_closed and is audited as a refusal", async () => {
    db.courtImage.findUnique.mockResolvedValue({
      id: DESIGN, number: "N-1", customerName: "R", caption: null, imageUrl: null, image2dUrl: "https://x.test/a.png",
      image3dUrl: null, video3dUrl: null, conversationId: uuid(6), accountContactId: null, contactPhone: null,
    });
    db.conversation.findUnique.mockResolvedValue({ id: uuid(6), contactPhone: "919876543210", lastInboundAt: new Date(Date.now() - 30 * 3_600_000) });
    db.optOut.findFirst.mockResolvedValue(null);
    db.contact.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/agent/v1/court-designs/[id]/send/route");
    const res = await POST(req("POST", `/api/agent/v1/court-designs/${DESIGN}/send`, { formats: ["2d"] }), { params: { id: DESIGN } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "window_closed" } });
    expect(lastAudit()).toMatchObject({ action: "refused:window_closed", toolName: "send_design" });
    expect(wa.sendText).not.toHaveBeenCalled();
  });
});

describe("tools with no route", () => {
  it("delete_deal, change_deal_owner, email_design_any_address and send_design_combined_pdf_unchecked have no route file", () => {
    const dirs = [
      "src/app/api/agent/v1/deals/[id]/delete",
      "src/app/api/agent/v1/deals/[id]/owner",
      "src/app/api/agent/v1/court-designs/[id]/email",
      "src/app/api/agent/v1/court-designs/[id]/combined-pdf",
      "src/app/api/agent/v1/court-designs/combined-pdf",
    ];
    for (const d of dirs) expect(existsSync(path.join(ROOT, d)), d).toBe(false);
  });

  it("the existing deal reads were left as they were: GET only on /deals and /deals/[id]", async () => {
    const list = await import("@/app/api/agent/v1/deals/route");
    const one = await import("@/app/api/agent/v1/deals/[id]/route");
    expect(Object.keys(list).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(["GET"]);
    expect(Object.keys(one).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(["GET"]);
  });
});
