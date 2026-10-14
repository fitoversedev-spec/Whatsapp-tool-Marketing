import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { agentAuditLog: { create: (...a: unknown[]) => create(...a) } } }));

import { buildAuditRow, redactSecrets, verifyRowHash, writeAgentAudit, type AuditInput } from "../audit";
import { generateKey } from "../keyFormat";

const input: AuditInput = {
  correlationId: "corr-12345",
  identityId: "idn-1",
  credentialId: "cred-1",
  environment: "staging",
  toolName: "whoami",
  httpMethod: "get",
  route: "/api/agent/v1/whoami?secret=1",
  ip: "203.0.113.9",
  recordIds: ["c1", "c2"],
  action: "read",
  result: "success",
  httpStatus: 200,
  durationMs: 12.6,
  idempotencyKey: null,
};
const NOW = new Date("2026-10-13T12:00:00.123Z");

beforeEach(() => {
  create.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("audit row", () => {
  it("is deterministic: same fields, same rowHash; verifies; any tamper breaks it", () => {
    const a = buildAuditRow(input, NOW, "id-1");
    const b = buildAuditRow(input, NOW, "id-1");
    expect(a.rowHash).toBe(b.rowHash);
    expect(a.rowHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyRowHash(a)).toBe(true);
    expect(verifyRowHash({ ...a, httpStatus: 500 })).toBe(false);
    expect(verifyRowHash({ ...a, result: "denied" })).toBe(false);
    expect(verifyRowHash({ ...a, recordIds: ["c1"] })).toBe(false);
    expect(verifyRowHash({ ...a, at: new Date(NOW.getTime() + 1) })).toBe(false);
  });

  it("normalises: method upper-cased, query string cut off, duration rounded", () => {
    const row = buildAuditRow(input, NOW, "id-1");
    expect(row.httpMethod).toBe("GET");
    expect(row.route).toBe("/api/agent/v1/whoami");
    expect(row.durationMs).toBe(13);
    expect(row.fieldsChanged).toBeNull();
  });

  it("has no column that could hold a secret, header or message body", () => {
    const keys = Object.keys(buildAuditRow(input, NOW, "id-1")).map((k) => k.toLowerCase());
    for (const forbidden of ["authorization", "headers", "body", "message", "secret", "token", "key", "payload", "query"]) {
      expect(keys.filter((k) => k === forbidden || k === `${forbidden}s`)).toEqual([]);
    }
  });

  it("redacts agent keys and bearer tokens from free text, and clips it", () => {
    const { key } = generateKey("staging");
    const text = `bad header: Authorization: Bearer ${key} and ${key}`;
    const out = redactSecrets(text);
    expect(out).not.toContain(key);
    expect(out).not.toContain(key.slice(-20));
    expect(out).toContain("[redacted-key]");
    expect(redactSecrets("Bearer abcdefghijklmnop")).toBe("Bearer [redacted]");
    const row = buildAuditRow({ ...input, failureReason: `${key} ${"x".repeat(2000)}` }, NOW, "id-1");
    expect(row.failureReason).not.toContain(key);
    expect(row.failureReason!.length).toBeLessThanOrEqual(500);
  });
});

describe("writeAgentAudit", () => {
  it("inserts the row with its hash", async () => {
    create.mockResolvedValue({});
    const row = await writeAgentAudit(input, { mutating: true });
    expect(row).not.toBeNull();
    const data = create.mock.calls[0][0].data;
    expect(data.rowHash).toBe(row!.rowHash);
    expect(data.toolName).toBe("whoami");
  });

  it("THROWS on failure for mutations so the caller fails closed", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(writeAgentAudit(input, { mutating: true })).rejects.toThrow("db down");
  });

  it("logs and carries on for reads", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(writeAgentAudit(input, { mutating: false })).resolves.toBeNull();
  });
});
