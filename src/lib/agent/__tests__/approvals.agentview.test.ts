import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  setting: { findUnique: vi.fn() },
  agentApprovalRequest: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const verifyCredential = vi.hoisted(() => vi.fn());
vi.mock("../keys", () => ({ verifyCredential: (...a: unknown[]) => verifyCredential(...a) }));
const writeAgentAudit = vi.hoisted(() => vi.fn());
vi.mock("../audit", () => ({ writeAgentAudit: (...a: unknown[]) => writeAgentAudit(...a) }));
const checkRateLimit = vi.hoisted(() => vi.fn());
vi.mock("../ratelimit", async () => {
  const actual = await vi.importActual<typeof import("../ratelimit")>("../ratelimit");
  return { ...actual, checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) };
});

import { TOOL_REGISTRY, effectiveVerdict } from "../permissions";
import { AGENT_ROUTES, buildOpenApi } from "../openapi";
import { TOOLS as APPROVALS_TOOLS } from "../registry/approvals";
import { getApprovalForIdentity } from "../approvals";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  identityId: "idn-1",
  correlationId: "corr-1234567",
  toolName: "send_marketing_template",
  inputJson: { conversationId: "c1", templateId: "t1", variables: [] },
  inputHash: "h",
  summary: "s",
  status: "executed",
  requestedAt: new Date("2026-10-13T08:00:00Z"),
  expiresAt: new Date(Date.now() + 3_600_000),
  decidedByUserId: "u-admin",
  decidedAt: new Date("2026-10-13T09:00:00Z"),
  decisionNote: "Fine to send",
  executedAt: new Date("2026-10-13T09:00:02Z"),
  resultJson: { sent: true },
  failureReason: null,
  ...over,
});

describe("get_approval_status registration", () => {
  it("is a read-only, allowed tool with an OpenAPI route", () => {
    expect(TOOL_REGISTRY.get_approval_status).toEqual({ default: "ALLOWED", action: "read" });
    expect(effectiveVerdict("get_approval_status")).toBe("ALLOWED");
    expect(AGENT_ROUTES.some((r) => r.tool === "get_approval_status" && r.method === "get" && r.path === "/approvals/{id}")).toBe(true);
    const doc = buildOpenApi() as { paths: Record<string, Record<string, any>> };
    expect(doc.paths["/approvals/{id}"].get["x-tool"]).toBe("get_approval_status");
  });

  it("there is no tool for the AI to approve, reject or run a request", () => {
    expect(Object.keys(APPROVALS_TOOLS)).toEqual(["get_approval_status"]);
    for (const n of Object.keys(TOOL_REGISTRY)) {
      expect(n, n).not.toMatch(/(approve|reject|decide|run|execute)_(approval|request)/i);
    }
  });
});

describe("a requesting identity reads only its own requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyCredential.mockResolvedValue({
      ok: true,
      context: { identityId: "idn-1", userId: "agent-user", credentialId: "cred-1", environment: "staging", ip: null },
      meta: { identityName: "Agent", credentialLabel: "l", keyPrefix: "fvai_stg_x", expiresAt: null },
    });
    writeAgentAudit.mockResolvedValue({});
    checkRateLimit.mockResolvedValue({ allowed: true });
    db.setting.findUnique.mockResolvedValue(null);
  });

  const get = (id: string) => new Request(`https://app.test/api/agent/v1/approvals/${id}`, { method: "GET" });

  it("returns status, decision note, timestamps and the result for its own request", async () => {
    db.agentApprovalRequest.findUnique.mockResolvedValue(row());
    const { GET } = await import("@/app/api/agent/v1/approvals/[id]/route");
    const res = await GET(get(ID), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: ID,
      tool: "send_marketing_template",
      status: "executed",
      requestedAt: "2026-10-13T08:00:00.000Z",
      expiresAt: expect.any(String),
      decidedAt: "2026-10-13T09:00:00.000Z",
      decisionNote: "Fine to send",
      executedAt: "2026-10-13T09:00:02.000Z",
      failureReason: null,
      result: { sent: true },
    });
    // never leaks who decided, the stored input, or the hash
    const body = JSON.stringify(await (await GET(get(ID), { params: { id: ID } })).json());
    expect(body).not.toContain("u-admin");
    expect(body).not.toContain("conversationId");
    expect(body).not.toContain("inputHash");
  });

  it("another identity's request looks exactly like one that does not exist (404)", async () => {
    db.agentApprovalRequest.findUnique.mockResolvedValue(row({ identityId: "some-other-identity" }));
    const { GET } = await import("@/app/api/agent/v1/approvals/[id]/route");
    const other = await GET(get(ID), { params: { id: ID } });
    db.agentApprovalRequest.findUnique.mockResolvedValue(null);
    const missing = await GET(get(ID), { params: { id: ID } });
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    const a = await other.json();
    const b = await missing.json();
    expect(a.error.code).toBe("not_found");
    expect(a.error.message).toBe(b.error.message);
  });

  it("a malformed id is a 404 without touching the database", async () => {
    const { GET } = await import("@/app/api/agent/v1/approvals/[id]/route");
    const res = await GET(get("a/b"), { params: { id: "a b!" } });
    expect(res.status).toBe(404);
    expect(db.agentApprovalRequest.findUnique).not.toHaveBeenCalled();
  });

  it("a pending request past its expiry is reported as expired before the sweep runs", async () => {
    const view = await (async () => {
      db.agentApprovalRequest.findUnique.mockResolvedValue(
        row({ status: "pending", expiresAt: new Date(Date.now() - 1000), decidedAt: null, decisionNote: null, executedAt: null, resultJson: null }),
      );
      return getApprovalForIdentity("idn-1", ID);
    })();
    expect(view).toMatchObject({ status: "expired", result: null });
    expect(await getApprovalForIdentity("idn-2", ID)).toBeNull();
  });

  it("an oversized stored result is replaced by a marker", async () => {
    db.agentApprovalRequest.findUnique.mockResolvedValue(row({ resultJson: { blob: "x".repeat(9000) } }));
    expect((await getApprovalForIdentity("idn-1", ID))?.result).toEqual({ truncated: true });
  });
});
