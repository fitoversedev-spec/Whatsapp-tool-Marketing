import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentCredential: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
const afterSpy = vi.fn();
vi.mock("@/lib/scout/after", () => ({ after: (fn: () => unknown) => afterSpy(fn) }));

import { generateKey, hashSecret, keyPrefix, parseKey } from "../keyFormat";
import { clientIp, hashesMatch, ipAllowed, verifyCredential } from "../keys";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.AGENT_API_ENV = "staging";
  delete process.env.AGENT_KEY_PEPPER;
  findUnique.mockReset();
  update.mockReset();
  afterSpy.mockReset();
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("key format", () => {
  it("generates fvai_<env3>_<keyId>_<secret> with a 32-byte base64url secret", () => {
    const { key, keyId, secretHash } = generateKey("staging");
    expect(key).toMatch(/^fvai_stg_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
    expect(keyId).toHaveLength(16);
    expect(secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(key.startsWith(keyPrefix("staging", keyId))).toBe(true);
    expect(generateKey("production").key.startsWith("fvai_prd_")).toBe(true);
    expect(generateKey("development").key.startsWith("fvai_dev_")).toBe(true);
  });

  it("round-trips through parseKey, including secrets that contain underscores", () => {
    for (let i = 0; i < 50; i++) {
      const { key, keyId, secretHash } = generateKey("staging");
      const parsed = parseKey(key)!;
      expect(parsed.environment).toBe("staging");
      expect(parsed.keyId).toBe(keyId);
      expect(hashSecret(parsed.secret)).toBe(secretHash);
    }
  });

  it.each([
    "",
    "fvai_stg_abc",
    "fvai_xxx_0123456789abcdef_" + "a".repeat(43),
    "FVAI_stg_0123456789abcdef_" + "a".repeat(43),
    "fvai_stg_0123456789ABCDEF_" + "a".repeat(43),
    "fvai_stg_0123456789abcdef_" + "a".repeat(42),
    "fvai_stg_0123456789abcdef_" + "a".repeat(44),
    "fvai_stg_0123456789abcdef_" + "a".repeat(42) + "!",
    "fvai_stg_0123456789abcdef_" + "a".repeat(43) + "_extra",
    "x".repeat(500),
  ])("rejects malformed key %#", (bad) => {
    expect(parseKey(bad)).toBeNull();
  });

  it("hashSecret is sha256 hex and the pepper changes it", () => {
    const plain = hashSecret("s3cret");
    expect(plain).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSecret("s3cret")).toBe(plain);
    process.env.AGENT_KEY_PEPPER = "pepper";
    expect(hashSecret("s3cret")).not.toBe(plain);
  });

  it("hashesMatch compares digests and rejects wrong lengths", () => {
    const h = hashSecret("a");
    expect(hashesMatch(h, h)).toBe(true);
    expect(hashesMatch(h, hashSecret("b"))).toBe(false);
    expect(hashesMatch(h, "abcd")).toBe(false);
    expect(hashesMatch("zz", "zz")).toBe(false);
  });
});

describe("clientIp / ipAllowed", () => {
  it("uses the first x-forwarded-for hop, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers({ "x-forwarded-for": "::ffff:203.0.113.5" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("an empty allowlist allows anyone; a populated one is exact or CIDR", () => {
    expect(ipAllowed(null, [])).toBe(true);
    expect(ipAllowed("1.2.3.4", [])).toBe(true);
    expect(ipAllowed("1.2.3.4", ["1.2.3.4"])).toBe(true);
    expect(ipAllowed("1.2.3.5", ["1.2.3.4"])).toBe(false);
    expect(ipAllowed(null, ["1.2.3.4"])).toBe(false);
    expect(ipAllowed("203.0.113.77", ["203.0.113.0/24"])).toBe(true);
    expect(ipAllowed("203.0.114.1", ["203.0.113.0/24"])).toBe(false);
    expect(ipAllowed("1.2.3.4", ["bogus/99", 5 as unknown as string])).toBe(false);
  });
});

function credentialFor(over: Record<string, unknown> = {}, envName: "staging" | "production" = "staging") {
  const g = generateKey(envName);
  const record = {
    id: "cred-1",
    keyId: g.keyId,
    secretHash: g.secretHash,
    environment: envName,
    label: "Sales agent (staging)",
    ipAllowlist: [],
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    identityId: "idn-1",
    identity: {
      id: "idn-1",
      userId: "usr-1",
      name: "Fitoverse AI Sales Agent",
      status: "active",
      user: { role: "ai_agent", isActive: true, deletedAt: null, approvalStatus: "approved" },
    },
    ...over,
  };
  return { key: g.key, record };
}
const bearer = (key: string, extra: Record<string, string> = {}) =>
  new Headers({ authorization: `Bearer ${key}`, "x-forwarded-for": "203.0.113.9", ...extra });

describe("verifyCredential", () => {
  it("accepts a good key and returns the context + safe meta", async () => {
    const { key, record } = credentialFor();
    findUnique.mockResolvedValue(record);
    const r = await verifyCredential(bearer(key));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context).toEqual({
      identityId: "idn-1",
      userId: "usr-1",
      credentialId: "cred-1",
      environment: "staging",
      ip: "203.0.113.9",
    });
    expect(r.meta.keyPrefix).toBe(`fvai_stg_${record.keyId}`);
    expect(JSON.stringify(r)).not.toContain(key);
    expect(JSON.stringify(r)).not.toContain(record.secretHash);
  });

  it("updates lastUsedAt in the background, at most once per 5 minutes", async () => {
    const stale = credentialFor({ lastUsedAt: new Date(Date.now() - 6 * 60_000) });
    findUnique.mockResolvedValue(stale.record);
    await verifyCredential(bearer(stale.key));
    expect(afterSpy).toHaveBeenCalledTimes(1);

    afterSpy.mockReset();
    const fresh = credentialFor({ lastUsedAt: new Date(Date.now() - 60_000) });
    findUnique.mockResolvedValue(fresh.record);
    await verifyCredential(bearer(fresh.key));
    expect(afterSpy).not.toHaveBeenCalled();

    afterSpy.mockReset();
    const never = credentialFor();
    findUnique.mockResolvedValue(never.record);
    await verifyCredential(bearer(never.key));
    await afterSpy.mock.calls[0][0]();
    expect(update).toHaveBeenCalledWith({
      where: { id: "cred-1" },
      data: { lastUsedAt: expect.any(Date), lastUsedIp: "203.0.113.9" },
    });
  });

  it("denies a missing or malformed Authorization header", async () => {
    expect(await verifyCredential(new Headers())).toMatchObject({ ok: false, reason: "missing_credential" });
    expect(await verifyCredential(new Headers({ authorization: "Basic abc" }))).toMatchObject({
      reason: "malformed_credential",
    });
    expect(await verifyCredential(new Headers({ authorization: "Bearer not-a-key" }))).toMatchObject({
      reason: "malformed_credential",
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("denies an unknown key id without attributing it to anyone", async () => {
    findUnique.mockResolvedValue(null);
    const r = await verifyCredential(bearer(generateKey("staging").key));
    expect(r).toMatchObject({ ok: false, reason: "unknown_key" });
    expect((r as { identityId?: string }).identityId).toBeUndefined();
  });

  it("denies a wrong secret", async () => {
    const { key, record } = credentialFor();
    findUnique.mockResolvedValue({ ...record, secretHash: generateKey("staging").secretHash });
    expect(await verifyCredential(bearer(key))).toMatchObject({ ok: false, reason: "bad_secret" });
  });

  it("denies revoked and expired keys (and attributes them)", async () => {
    const revoked = credentialFor({ revokedAt: new Date() });
    findUnique.mockResolvedValue(revoked.record);
    expect(await verifyCredential(bearer(revoked.key))).toMatchObject({
      reason: "revoked",
      identityId: "idn-1",
      credentialId: "cred-1",
    });
    const expired = credentialFor({ expiresAt: new Date(Date.now() - 1000) });
    findUnique.mockResolvedValue(expired.record);
    expect(await verifyCredential(bearer(expired.key))).toMatchObject({ reason: "expired" });
  });

  it("denies a suspended identity or a user that is not an active ai_agent", async () => {
    const mk = (identity: Record<string, unknown>) => {
      const c = credentialFor();
      return { key: c.key, record: { ...c.record, identity: { ...c.record.identity, ...identity } } };
    };
    for (const identity of [
      { status: "suspended" },
      { status: "revoked" },
      { user: { role: "admin", isActive: true, deletedAt: null, approvalStatus: "approved" } },
      { user: { role: "ai_agent", isActive: false, deletedAt: null, approvalStatus: "approved" } },
      { user: { role: "ai_agent", isActive: true, deletedAt: new Date(), approvalStatus: "approved" } },
      { user: { role: "ai_agent", isActive: true, deletedAt: null, approvalStatus: "pending" } },
    ]) {
      const c = mk(identity);
      findUnique.mockResolvedValue(c.record);
      expect(await verifyCredential(bearer(c.key))).toMatchObject({ ok: false, reason: "identity_inactive" });
    }
  });

  it("denies a key whose environment is not this deployment's", async () => {
    const prod = credentialFor({}, "production");
    findUnique.mockResolvedValue(prod.record);
    expect(await verifyCredential(bearer(prod.key))).toMatchObject({ reason: "environment_mismatch" });
  });

  it("denies everything when AGENT_API_ENV is unset or invalid", async () => {
    const { key, record } = credentialFor();
    findUnique.mockResolvedValue(record);
    delete process.env.AGENT_API_ENV;
    expect(await verifyCredential(bearer(key))).toMatchObject({ reason: "server_misconfigured" });
    process.env.AGENT_API_ENV = "prod";
    expect(await verifyCredential(bearer(key))).toMatchObject({ reason: "server_misconfigured" });
  });

  it("enforces the IP allowlist when it is non-empty", async () => {
    const { key, record } = credentialFor({ ipAllowlist: ["198.51.100.1"] });
    findUnique.mockResolvedValue(record);
    expect(await verifyCredential(bearer(key))).toMatchObject({ reason: "ip_not_allowed", identityId: "idn-1" });
    const ok = await verifyCredential(bearer(key, { "x-forwarded-for": "198.51.100.1, 203.0.113.9" }));
    expect(ok.ok).toBe(true);
  });
});
