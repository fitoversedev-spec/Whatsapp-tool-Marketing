import { describe, expect, it } from "vitest";
import {
  AGENT_ERROR_CODES,
  AgentHttpError,
  DEFAULT_STATUS,
  buildErrorBody,
  errorResponse,
  jsonResponse,
  resolveCorrelationId,
} from "../errors";

describe("agent errors", () => {
  it("has the stable code set", () => {
    expect([...AGENT_ERROR_CODES].sort()).toEqual(
      [
        "unauthorized",
        "forbidden",
        "never_allowed",
        "approval_required",
        "rate_limited",
        "invalid_input",
        "idempotency_conflict",
        "not_found",
        "internal",
      ].sort(),
    );
    for (const code of AGENT_ERROR_CODES) expect(DEFAULT_STATUS[code]).toBeGreaterThanOrEqual(200);
  });

  it("builds { error: { code, message, correlationId } } and nothing else", () => {
    const body = buildErrorBody("not_found", "No such thing.", "corr-12345");
    expect(body).toEqual({ error: { code: "not_found", message: "No such thing.", correlationId: "corr-12345" } });
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "correlationId", "message"]);
  });

  it("errorResponse sets status, JSON, no-store and the correlation header", async () => {
    const res = errorResponse("rate_limited", "Slow down.", "corr-12345", { headers: { "Retry-After": "7" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-correlation-id")).toBe("corr-12345");
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toEqual({
      error: { code: "rate_limited", message: "Slow down.", correlationId: "corr-12345" },
    });
  });

  it("jsonResponse also carries no-store and the correlation id", () => {
    const res = jsonResponse({ ok: true }, 200, "corr-12345");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-correlation-id")).toBe("corr-12345");
  });

  it("AgentHttpError defaults its status from the code", () => {
    expect(new AgentHttpError("not_found", "x").status).toBe(404);
    expect(new AgentHttpError("invalid_input", "x", 422).status).toBe(422);
  });

  it("resolveCorrelationId keeps a safe caller id and replaces anything else", () => {
    expect(resolveCorrelationId("abc-DEF_123.456")).toBe("abc-DEF_123.456");
    for (const bad of [null, undefined, "", "short", "has space in it", "x".repeat(65), "bad/char!!", "line\nbreak123"]) {
      expect(resolveCorrelationId(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
