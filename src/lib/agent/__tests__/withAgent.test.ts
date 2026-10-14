import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));

const verifyCredential = vi.fn();
vi.mock("../keys", () => ({ verifyCredential: (...a: unknown[]) => verifyCredential(...a) }));
const writeAgentAudit = vi.fn();
vi.mock("../audit", () => ({ writeAgentAudit: (...a: unknown[]) => writeAgentAudit(...a) }));
const checkRateLimit = vi.fn();
vi.mock("../ratelimit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
const getEffectiveVerdict = vi.fn();
vi.mock("../permissions", async () => {
  const actual = await vi.importActual<typeof import("../permissions")>("../permissions");
  return { ...actual, getEffectiveVerdict: (...a: unknown[]) => getEffectiveVerdict(...a) };
});
const beginIdempotent = vi.fn();
const completeIdempotent = vi.fn();
const failIdempotent = vi.fn();
vi.mock("../idempotency", async () => {
  const actual = await vi.importActual<typeof import("../idempotency")>("../idempotency");
  return {
    ...actual,
    beginIdempotent: (...a: unknown[]) => beginIdempotent(...a),
    completeIdempotent: (...a: unknown[]) => completeIdempotent(...a),
    failIdempotent: (...a: unknown[]) => failIdempotent(...a),
  };
});
const requestApproval = vi.fn();
vi.mock("../approvals", () => ({ requestApproval: (...a: unknown[]) => requestApproval(...a) }));

import { AgentHttpError } from "../errors";
import { TOOL_REGISTRY } from "../permissions";
import { withAgent } from "../withAgent";

const GOOD = {
  ok: true,
  context: { identityId: "idn-1", userId: "usr-1", credentialId: "cred-1", environment: "staging", ip: "203.0.113.9" },
  meta: { identityName: "Agent", credentialLabel: "label", keyPrefix: "fvai_stg_abc", expiresAt: null },
};
const URL_ = "https://app.test/api/agent/v1/thing";
const IDEM = { "idempotency-key": "idem-key-0001" };

const get = (headers: Record<string, string> = {}) => new Request(URL_, { method: "GET", headers });
const post = (body: unknown, headers: Record<string, string> = IDEM) =>
  new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const lastAudit = () => writeAgentAudit.mock.calls.at(-1)![0] as Record<string, unknown>;
const lastAuditOpts = () => writeAgentAudit.mock.calls.at(-1)![1] as { mutating: boolean };

beforeEach(() => {
  TOOL_REGISTRY.t_read = { default: "ALLOWED", action: "read" };
  TOOL_REGISTRY.t_write = { default: "ALLOWED", action: "create" };
  for (const m of [verifyCredential, writeAgentAudit, checkRateLimit, getEffectiveVerdict, beginIdempotent, completeIdempotent, failIdempotent, requestApproval]) {
    m.mockReset();
  }
  verifyCredential.mockResolvedValue(GOOD);
  getEffectiveVerdict.mockResolvedValue("ALLOWED");
  checkRateLimit.mockResolvedValue({ allowed: true });
  beginIdempotent.mockResolvedValue({ kind: "execute" });
  writeAgentAudit.mockImplementation(async (_row: unknown, opts: { mutating: boolean }) => ({ ok: opts }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  delete TOOL_REGISTRY.t_read;
  delete TOOL_REGISTRY.t_write;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("authentication", () => {
  it("returns a generic 401 for an unknown caller, echoes a safe correlation id, and writes no audit row", async () => {
    verifyCredential.mockResolvedValue({ ok: false, reason: "unknown_key", ip: "1.2.3.4" });
    const handler = vi.fn();
    const res = await withAgent("t_read", handler, { mutating: false })(get({ "x-correlation-id": "my-corr-id-1" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-correlation-id")).toBe("my-corr-id-1");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String), correlationId: "my-corr-id-1" },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(writeAgentAudit).not.toHaveBeenCalled();
  });

  it("replaces an unsafe correlation id with a UUID", async () => {
    verifyCredential.mockResolvedValue({ ok: false, reason: "missing_credential", ip: null });
    const res = await withAgent("t_read", vi.fn(), { mutating: false })(get({ "x-correlation-id": "bad id!" }));
    expect(res.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives the same 401 body for every denial reason, but audits the ones it can attribute", async () => {
    const bodies = new Set<string>();
    for (const reason of ["revoked", "expired", "bad_secret", "ip_not_allowed"]) {
      verifyCredential.mockResolvedValue({ ok: false, reason, ip: "1.2.3.4", identityId: "idn-1", credentialId: "cred-1", environment: "staging" });
      const res = await withAgent("t_read", vi.fn(), { mutating: false })(get({ "x-correlation-id": "corr-fixed-1" }));
      expect(res.status).toBe(401);
      bodies.add(await res.text());
      expect(lastAudit()).toMatchObject({ identityId: "idn-1", result: "denied", httpStatus: 401, failureReason: `auth:${reason}` });
    }
    expect(bodies.size).toBe(1);
  });
});

describe("permissions and limits", () => {
  it("NEVER -> 403 never_allowed, handler untouched, audited as denied", async () => {
    getEffectiveVerdict.mockResolvedValue("NEVER");
    const handler = vi.fn();
    const res = await withAgent("t_read", handler, { mutating: false })(get());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("never_allowed");
    expect(handler).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "denied", httpStatus: 403 });
  });

  it("APPROVAL -> 202 { approvalId, status: pending }, nothing executed, audited as pending_approval", async () => {
    getEffectiveVerdict.mockResolvedValue("APPROVAL");
    requestApproval.mockResolvedValue({ approvalId: "appr-1", created: true });
    const handler = vi.fn();
    const res = await withAgent("t_write", handler, { mutating: true })(post({ a: 1 }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ approvalId: "appr-1", status: "pending" });
    expect(handler).not.toHaveBeenCalled();
    expect(beginIdempotent).not.toHaveBeenCalled();
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ identityId: "idn-1", toolName: "t_write", input: { a: 1 } }));
    expect(lastAudit()).toMatchObject({ result: "pending_approval", httpStatus: 202, approvalId: "appr-1" });
  });

  it("rate limited -> 429 + Retry-After, handler untouched, and no approval is queued", async () => {
    getEffectiveVerdict.mockResolvedValue("APPROVAL");
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 17, scope: "m:all", limit: 60 });
    const handler = vi.fn();
    const res = await withAgent("t_write", handler, { mutating: true })(post({}));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect((await res.json()).error.code).toBe("rate_limited");
    expect(handler).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "rate_limited", httpStatus: 429 });
  });
});

describe("a read", () => {
  it("runs the handler with the context and writes exactly one audit row", async () => {
    const handler = vi.fn().mockResolvedValue({ body: { hello: "world" } });
    const res = await withAgent("t_read", handler, { mutating: false })(get({ "x-correlation-id": "corr-read-001" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    expect(handler.mock.calls[0][0].ctx).toEqual({ ...GOOD.context, correlationId: "corr-read-001" });
    expect(writeAgentAudit).toHaveBeenCalledTimes(1);
    expect(lastAudit()).toMatchObject({
      correlationId: "corr-read-001",
      identityId: "idn-1",
      credentialId: "cred-1",
      environment: "staging",
      toolName: "t_read",
      httpMethod: "GET",
      route: "/api/agent/v1/thing",
      action: "read",
      result: "success",
      httpStatus: 200,
    });
    expect(lastAuditOpts()).toEqual({ mutating: false });
    expect(beginIdempotent).not.toHaveBeenCalled();
  });

  it("validates the query string with the input schema -> 400, handler untouched", async () => {
    const handler = vi.fn();
    const route = withAgent("t_read", handler, { mutating: false, inputSchema: z.object({ n: z.string().regex(/^\d+$/) }) });
    const res = await route(new Request(`${URL_}?n=abc`));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_input");
    expect(handler).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "invalid", httpStatus: 400 });
  });

  it("a failing audit write does not break a read", async () => {
    writeAgentAudit.mockResolvedValue(null);
    const res = await withAgent("t_read", vi.fn().mockResolvedValue({ body: { ok: 1 } }), { mutating: false })(get());
    expect(res.status).toBe(200);
  });
});

describe("a mutation", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("requires a valid Idempotency-Key", async () => {
    const handler = vi.fn();
    const badHeaders: Record<string, string>[] = [{}, { "idempotency-key": "short" }, { "idempotency-key": "has spaces in it!" }];
    for (const headers of badHeaders) {
      const res = await withAgent("t_write", handler, { mutating: true })(post({ name: "x" }, headers));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_input");
    }
    expect(handler).not.toHaveBeenCalled();
    expect(beginIdempotent).not.toHaveBeenCalled();
  });

  it("claims the key, runs once, stores the response, audits with mutating:true", async () => {
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { id: "c1" }, recordIds: ["c1"], fieldsChanged: ["name"] });
    const res = await withAgent("t_write", handler, { mutating: true, inputSchema: schema })(post({ name: "Acme" }));
    expect(res.status).toBe(201);
    expect(handler.mock.calls[0][0].input).toEqual({ name: "Acme" });
    expect(handler.mock.calls[0][0].idempotencyKey).toBe("idem-key-0001");
    expect(beginIdempotent).toHaveBeenCalledWith("idn-1", "idem-key-0001", expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(completeIdempotent).toHaveBeenCalledWith("idn-1", "idem-key-0001", 201, { id: "c1" });
    expect(lastAudit()).toMatchObject({
      action: "create",
      result: "success",
      httpStatus: 201,
      recordIds: ["c1"],
      fieldsChanged: ["name"],
      idempotencyKey: "idem-key-0001",
    });
    expect(lastAuditOpts()).toEqual({ mutating: true });
  });

  it("invalid input never claims a key", async () => {
    const res = await withAgent("t_write", vi.fn(), { mutating: true, inputSchema: schema })(post({ name: "" }));
    expect(res.status).toBe(400);
    expect(beginIdempotent).not.toHaveBeenCalled();
    const bad = await withAgent("t_write", vi.fn(), { mutating: true, inputSchema: schema })(post("{not json"));
    expect(bad.status).toBe(400);
  });

  it("replays a stored response without running the handler, and audits it as a replay", async () => {
    beginIdempotent.mockResolvedValue({ kind: "replay", status: 201, body: { id: "c1" } });
    const handler = vi.fn();
    const res = await withAgent("t_write", handler, { mutating: true })(post({ name: "Acme" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("idempotent-replay")).toBe("true");
    expect(await res.json()).toEqual({ id: "c1" });
    expect(handler).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ action: "replay:create", result: "success" });
  });

  it("same key with a different request -> 422 idempotency_conflict", async () => {
    beginIdempotent.mockResolvedValue({ kind: "conflict" });
    const res = await withAgent("t_write", vi.fn(), { mutating: true })(post({ name: "Other" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("idempotency_conflict");
  });

  it("same key still running -> 409 + Retry-After", async () => {
    beginIdempotent.mockResolvedValue({ kind: "in_progress", retryAfterSec: 12 });
    const res = await withAgent("t_write", vi.fn(), { mutating: true })(post({ name: "Acme" }));
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("12");
  });

  it("an AgentHttpError becomes its own response and is stored for replay", async () => {
    const handler = vi.fn().mockRejectedValue(new AgentHttpError("not_found", "No such contact."));
    const res = await withAgent("t_write", handler, { mutating: true })(post({ name: "x" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({ code: "not_found", message: "No such contact." });
    expect(completeIdempotent).toHaveBeenCalledWith("idn-1", "idem-key-0001", 404, expect.anything());
    expect(lastAudit()).toMatchObject({ result: "invalid", httpStatus: 404 });
  });

  it("an unexpected error is a generic 500 that leaks nothing, frees the key, and records only the error class", async () => {
    const secretish = "connection to postgres://user:pass@host/db failed; query: SELECT * FROM contacts";
    const handler = vi.fn().mockRejectedValue(Object.assign(new Error(secretish), { code: "P2002" }));
    const res = await withAgent("t_write", handler, { mutating: true })(post({ name: "x" }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("postgres");
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("stack");
    expect(JSON.parse(text).error.code).toBe("internal");
    expect(failIdempotent).toHaveBeenCalledWith("idn-1", "idem-key-0001");
    expect(completeIdempotent).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "error", httpStatus: 500, failureReason: "Error:P2002" });
    expect(JSON.stringify(lastAudit())).not.toContain("postgres");
  });

  it("FAILS CLOSED when the audit row cannot be written", async () => {
    writeAgentAudit.mockRejectedValue(new Error("audit table unavailable"));
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { id: "c1" } });
    const res = await withAgent("t_write", handler, { mutating: true })(post({ name: "x" }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(JSON.stringify(body)).not.toContain("audit table unavailable");
  });

  it("times out after 25 s with a 504 and leaves the idempotency lease alone", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(() => new Promise<never>(() => undefined));
    const pending = withAgent("t_write", handler, { mutating: true })(post({ name: "x" }));
    await vi.advanceTimersByTimeAsync(24_000);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(completeIdempotent).not.toHaveBeenCalled();
    expect(failIdempotent).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ result: "error", httpStatus: 504, failureReason: "handler_timeout" });
  });
});
