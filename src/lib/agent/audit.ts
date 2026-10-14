import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashCanonical } from "./canonical";

/**
 * One row per agent API call, append-only (database triggers refuse UPDATE,
 * DELETE and TRUNCATE) and sealed with a rowHash over its own fields.
 *
 * What is NEVER written here: the Authorization header or any key, request or
 * response bodies, message text, query strings. Only identifiers and field
 * NAMES. Free text (failureReason) is run through redactSecrets() as a belt and
 * braces.
 */
export type AuditResult = "success" | "denied" | "error" | "pending_approval" | "rate_limited" | "invalid";

export type AuditInput = {
  correlationId: string;
  identityId: string;
  credentialId?: string | null;
  environment: string;
  toolName: string;
  httpMethod: string;
  /** The URL path only; any query string is cut off. */
  route: string;
  ip?: string | null;
  recordIds?: string[];
  action: string;
  result: AuditResult;
  httpStatus: number;
  fieldsChanged?: string[] | null;
  approvalId?: string | null;
  failureReason?: string | null;
  durationMs: number;
  idempotencyKey?: string | null;
};

export type AuditRow = {
  id: string;
  at: Date;
  correlationId: string;
  identityId: string;
  credentialId: string | null;
  environment: string;
  toolName: string;
  httpMethod: string;
  route: string;
  ip: string | null;
  recordIds: string[];
  action: string;
  result: AuditResult;
  httpStatus: number;
  fieldsChanged: string[] | null;
  approvalId: string | null;
  failureReason: string | null;
  durationMs: number;
  idempotencyKey: string | null;
  rowHash: string;
};

const KEY_RE = /fvai_(?:dev|stg|prd)_[a-f0-9]{16}_[A-Za-z0-9_-]{43}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

export function redactSecrets(text: string): string {
  return text.replace(KEY_RE, "[redacted-key]").replace(BEARER_RE, "Bearer [redacted]");
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/** Hash of every field except rowHash itself. Anyone can recompute it from a stored row. */
export function computeRowHash(row: Omit<AuditRow, "rowHash">): string {
  return hashCanonical({ ...row, at: row.at.toISOString() });
}

export function verifyRowHash(row: AuditRow): boolean {
  const { rowHash, ...rest } = row;
  return computeRowHash(rest) === rowHash;
}

export function buildAuditRow(input: AuditInput, now: Date = new Date(), id: string = randomUUID()): AuditRow {
  const base: Omit<AuditRow, "rowHash"> = {
    id,
    at: now,
    correlationId: clip(input.correlationId, 64),
    identityId: input.identityId,
    credentialId: input.credentialId ?? null,
    environment: clip(input.environment, 32),
    toolName: clip(input.toolName, 100),
    httpMethod: clip(input.httpMethod.toUpperCase(), 10),
    route: clip(input.route.split("?")[0], 300),
    ip: input.ip ? clip(input.ip, 64) : null,
    recordIds: (input.recordIds ?? []).slice(0, 200).map((r) => clip(String(r), 100)),
    action: clip(input.action, 100),
    result: input.result,
    httpStatus: input.httpStatus,
    fieldsChanged: input.fieldsChanged ? input.fieldsChanged.slice(0, 100).map((f) => clip(String(f), 100)) : null,
    approvalId: input.approvalId ?? null,
    failureReason: input.failureReason ? clip(redactSecrets(input.failureReason), 500) : null,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    idempotencyKey: input.idempotencyKey ? clip(input.idempotencyKey, 128) : null,
  };
  return { ...base, rowHash: computeRowHash(base) };
}

/**
 * Append the audit row.
 *
 * `mutating: true`  -> a failure to write THROWS, so the caller can fail closed
 *                      instead of reporting success for an action nobody can
 *                      account for.
 * `mutating: false` -> (reads) a failure is logged and swallowed; losing one read
 *                      record must not take reads down.
 */
export async function writeAgentAudit(input: AuditInput, opts: { mutating: boolean }): Promise<AuditRow | null> {
  const row = buildAuditRow(input);
  try {
    await prisma.agentAuditLog.create({
      data: {
        ...row,
        recordIds: row.recordIds as Prisma.InputJsonValue,
        fieldsChanged: (row.fieldsChanged ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return row;
  } catch (error) {
    console.error("[agent-audit] failed to write audit row", {
      correlationId: row.correlationId,
      toolName: row.toolName,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (opts.mutating) throw error;
    return null;
  }
}
