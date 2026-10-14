import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { after } from "@/lib/scout/after";
import { hashCanonical } from "./canonical";

/**
 * Idempotency for mutating tools. The agent's network may retry; the same
 * request must never run twice.
 *
 *   first call            insert an "in_progress" row holding a 60 s lease, run
 *   same key + same body  completed -> replay the stored response (no re-run)
 *                         in progress & lease live -> 409 + Retry-After
 *                         in progress & lease stale, or failed -> reclaim, re-run
 *   same key + other body 422 idempotency_conflict
 *
 * Every step is a single statement (INSERT ... ON CONFLICT DO NOTHING, or an
 * UPDATE with a guard in its WHERE), so it is race-safe without an interactive
 * transaction and works through PgBouncer.
 */
export const IDEMPOTENCY_LEASE_MS = 60_000;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Returns the key when it is 8-128 chars of [A-Za-z0-9._:-], else null. */
export function validateIdempotencyKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  return KEY_PATTERN.test(raw) ? raw : null;
}

/** What "the same request" means: method + path + query + body, canonicalised. */
export function hashRequest(parts: { method: string; path: string; query?: string; body?: unknown }): string {
  return hashCanonical({
    method: parts.method.toUpperCase(),
    path: parts.path,
    query: parts.query ?? "",
    body: parts.body ?? null,
  });
}

export type StoredKey = {
  requestHash: string;
  status: string;
  responseStatus: number | null;
  responseBody: unknown;
  lockedUntil: Date | null;
};

export type Decision =
  | { action: "replay"; status: number; body: unknown }
  | { action: "conflict" }
  | { action: "in_progress"; retryAfterSec: number }
  | { action: "reclaim" };

/** Pure: what to do when a row already exists for (identity, key). */
export function decide(existing: StoredKey, requestHash: string, now: number): Decision {
  if (existing.requestHash !== requestHash) return { action: "conflict" };
  if (existing.status === "completed" && existing.responseStatus !== null) {
    return { action: "replay", status: existing.responseStatus, body: existing.responseBody };
  }
  if (existing.status === "in_progress" && existing.lockedUntil && existing.lockedUntil.getTime() > now) {
    return {
      action: "in_progress",
      retryAfterSec: Math.max(1, Math.ceil((existing.lockedUntil.getTime() - now) / 1000)),
    };
  }
  // A failed attempt, or an in-progress one whose lease ran out (the worker died).
  return { action: "reclaim" };
}

export type BeginResult =
  | { kind: "execute" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "in_progress"; retryAfterSec: number };

export async function beginIdempotent(
  identityId: string,
  key: string,
  requestHash: string,
  nowMs = Date.now(),
  attempt = 0,
): Promise<BeginResult> {
  const now = new Date(nowMs);
  const lockedUntil = new Date(nowMs + IDEMPOTENCY_LEASE_MS);

  const inserted = await prisma.agentIdempotencyKey.createMany({
    data: [
      {
        identityId,
        key,
        requestHash,
        status: "in_progress",
        lockedUntil,
        expiresAt: new Date(nowMs + IDEMPOTENCY_TTL_MS),
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 1) {
    if (Math.random() < 0.01) {
      after(() => prisma.agentIdempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } }));
    }
    return { kind: "execute" };
  }

  const existing = await prisma.agentIdempotencyKey.findUnique({
    where: { identityId_key: { identityId, key } },
  });
  // Vanished (expired and cleaned) between the insert and the read: try again.
  if (!existing) {
    if (attempt < 2) return beginIdempotent(identityId, key, requestHash, nowMs, attempt + 1);
    return { kind: "in_progress", retryAfterSec: 1 };
  }
  // Past its 24 h life: treat as new.
  if (existing.expiresAt.getTime() <= nowMs && attempt < 2) {
    await prisma.agentIdempotencyKey.deleteMany({ where: { identityId, key, expiresAt: { lte: now } } });
    return beginIdempotent(identityId, key, requestHash, nowMs, attempt + 1);
  }

  const d = decide(existing, requestHash, nowMs);
  if (d.action === "replay") return { kind: "replay", status: d.status, body: d.body };
  if (d.action === "conflict") return { kind: "conflict" };
  if (d.action === "in_progress") return { kind: "in_progress", retryAfterSec: d.retryAfterSec };

  // Take over atomically: only one concurrent caller can win this UPDATE.
  const claimed = await prisma.agentIdempotencyKey.updateMany({
    where: {
      identityId,
      key,
      requestHash,
      OR: [{ status: "failed" }, { status: "in_progress", lockedUntil: { lt: now } }],
    },
    data: { status: "in_progress", lockedUntil, attempts: { increment: 1 }, responseStatus: null },
  });
  return claimed.count === 1 ? { kind: "execute" } : { kind: "in_progress", retryAfterSec: 5 };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** Store the response so a retry with the same key replays it. */
export async function completeIdempotent(identityId: string, key: string, status: number, body: unknown) {
  await prisma.agentIdempotencyKey.updateMany({
    where: { identityId, key, status: "in_progress" },
    data: { status: "completed", responseStatus: status, responseBody: toJson(body), lockedUntil: null },
  });
}

/** The attempt failed in a retryable way (5xx): the same key may run again. */
export async function failIdempotent(identityId: string, key: string) {
  await prisma.agentIdempotencyKey.updateMany({
    where: { identityId, key, status: "in_progress" },
    data: { status: "failed", lockedUntil: null },
  });
}

/** The request never reached the handler (e.g. invalid input): free the key for a corrected retry. */
export async function releaseIdempotent(identityId: string, key: string) {
  await prisma.agentIdempotencyKey.deleteMany({ where: { identityId, key, status: "in_progress" } });
}
