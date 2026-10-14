import { beforeEach, describe, expect, it, vi } from "vitest";

const createMany = vi.fn();
const findUnique = vi.fn();
const updateMany = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentIdempotencyKey: {
      createMany: (...a: unknown[]) => createMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));

import {
  beginIdempotent,
  decide,
  hashRequest,
  IDEMPOTENCY_LEASE_MS,
  validateIdempotencyKey,
  type StoredKey,
} from "../idempotency";

beforeEach(() => {
  createMany.mockReset();
  findUnique.mockReset();
  updateMany.mockReset();
  deleteMany.mockReset();
});

describe("validateIdempotencyKey", () => {
  it("accepts 8-128 safe characters", () => {
    for (const ok of ["abcdefgh", "a1b2c3d4-e5f6.g7h8:i9_j0", "x".repeat(128), "01J9Z6TQ4M8N3W5R"]) {
      expect(validateIdempotencyKey(ok)).toBe(ok);
    }
  });
  it("rejects short, long, unsafe or missing keys", () => {
    for (const bad of ["abcdefg", "x".repeat(129), "has space!!", "semi;colon1", "new\nline123", "quote'quote1", "", null, undefined]) {
      expect(validateIdempotencyKey(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("hashRequest", () => {
  const base = { method: "POST", path: "/api/agent/v1/x", query: "", body: { a: 1, b: { c: [1, 2], d: "x" } } };
  it("ignores object key order", () => {
    expect(hashRequest(base)).toBe(hashRequest({ ...base, body: { b: { d: "x", c: [1, 2] }, a: 1 } }));
  });
  it("changes with method, path, query or body", () => {
    const h = hashRequest(base);
    expect(hashRequest({ ...base, method: "PUT" })).not.toBe(h);
    expect(hashRequest({ ...base, path: "/api/agent/v1/y" })).not.toBe(h);
    expect(hashRequest({ ...base, query: "a=1" })).not.toBe(h);
    expect(hashRequest({ ...base, body: { a: 2 } })).not.toBe(h);
    expect(hashRequest({ ...base, body: { a: 1, b: { c: [2, 1], d: "x" } } })).not.toBe(h);
  });
  it("is case-insensitive on method only", () => {
    expect(hashRequest({ ...base, method: "post" })).toBe(hashRequest(base));
  });
});

describe("decide", () => {
  const now = 1_000_000;
  const row = (over: Partial<StoredKey> = {}): StoredKey => ({
    requestHash: "H",
    status: "in_progress",
    responseStatus: null,
    responseBody: null,
    lockedUntil: new Date(now + 30_000),
    ...over,
  });

  it("same key, different request -> conflict, whatever the state", () => {
    expect(decide(row(), "OTHER", now)).toEqual({ action: "conflict" });
    expect(decide(row({ status: "completed", responseStatus: 200 }), "OTHER", now)).toEqual({ action: "conflict" });
    expect(decide(row({ status: "failed" }), "OTHER", now)).toEqual({ action: "conflict" });
  });

  it("completed -> replay the stored response", () => {
    expect(decide(row({ status: "completed", responseStatus: 201, responseBody: { id: "x" }, lockedUntil: null }), "H", now)).toEqual({
      action: "replay",
      status: 201,
      body: { id: "x" },
    });
  });

  it("in progress with a live lease -> in_progress with Retry-After", () => {
    expect(decide(row(), "H", now)).toEqual({ action: "in_progress", retryAfterSec: 30 });
    expect(decide(row({ lockedUntil: new Date(now + 400) }), "H", now)).toEqual({ action: "in_progress", retryAfterSec: 1 });
  });

  it("in progress with a stale lease, or failed -> reclaim", () => {
    expect(decide(row({ lockedUntil: new Date(now - 1) }), "H", now)).toEqual({ action: "reclaim" });
    expect(decide(row({ lockedUntil: new Date(now) }), "H", now)).toEqual({ action: "reclaim" });
    expect(decide(row({ lockedUntil: null }), "H", now)).toEqual({ action: "reclaim" });
    expect(decide(row({ status: "failed", lockedUntil: null }), "H", now)).toEqual({ action: "reclaim" });
  });

  it("the lease is 60 seconds", () => {
    expect(IDEMPOTENCY_LEASE_MS).toBe(60_000);
  });
});

describe("beginIdempotent", () => {
  const now = 5_000_000;
  const stored = (over: Partial<StoredKey & { expiresAt: Date }> = {}) => ({
    requestHash: "H",
    status: "in_progress",
    responseStatus: null,
    responseBody: null,
    lockedUntil: new Date(now + 30_000),
    expiresAt: new Date(now + 3_600_000),
    ...over,
  });

  it("first call inserts an in-progress row with a lease and executes", async () => {
    createMany.mockResolvedValue({ count: 1 });
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toEqual({ kind: "execute" });
    const data = createMany.mock.calls[0][0].data[0];
    expect(data).toMatchObject({ identityId: "idn", key: "key-12345678", requestHash: "H", status: "in_progress" });
    expect(data.lockedUntil.getTime()).toBe(now + IDEMPOTENCY_LEASE_MS);
    expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("replays a completed identical request without touching it", async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(stored({ status: "completed", responseStatus: 200, responseBody: { ok: 1 } }));
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toEqual({ kind: "replay", status: 200, body: { ok: 1 } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns conflict for the same key with a different request", async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(stored({ requestHash: "DIFFERENT" }));
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toEqual({ kind: "conflict" });
  });

  it("returns in_progress while another request holds the lease", async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(stored());
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toEqual({ kind: "in_progress", retryAfterSec: 30 });
  });

  it("reclaims a stale lease with one guarded UPDATE", async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(stored({ lockedUntil: new Date(now - 5_000) }));
    updateMany.mockResolvedValue({ count: 1 });
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toEqual({ kind: "execute" });
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ identityId: "idn", key: "key-12345678", requestHash: "H" });
    expect(arg.data).toMatchObject({ status: "in_progress", attempts: { increment: 1 } });
  });

  it("loses gracefully when someone else reclaims first", async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(stored({ lockedUntil: new Date(now - 5_000) }));
    updateMany.mockResolvedValue({ count: 0 });
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toMatchObject({ kind: "in_progress" });
  });

  it("re-executes after a failed attempt with the same request", async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(stored({ status: "failed", lockedUntil: null }));
    updateMany.mockResolvedValue({ count: 1 });
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toEqual({ kind: "execute" });
  });

  it("treats an expired row as new", async () => {
    createMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValue(stored({ status: "completed", responseStatus: 200, expiresAt: new Date(now - 1) }));
    deleteMany.mockResolvedValue({ count: 1 });
    expect(await beginIdempotent("idn", "key-12345678", "H", now)).toEqual({ kind: "execute" });
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });
});
