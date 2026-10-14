import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashCanonical } from "./canonical";
import { AgentHttpError } from "./errors";

/**
 * Human approvals for the AI Sales Agent.
 *
 * withAgent queues a request when a tool's verdict is APPROVAL (requestApproval).
 * The exact proposed input is stored (the approver must see what they are
 * approving) together with a hash of it, so an identical retry reuses the
 * pending row instead of piling up duplicates, and so tampering with the stored
 * input is detectable before anything runs.
 *
 * Lifecycle:  pending -> approved -> executed | failed
 *             pending -> rejected | expired
 * "approved" with a failureReason means "approved, but nothing could be run".
 * Deciding and running live in ./approvalRunner.ts; this file is the data side.
 */
export const APPROVAL_TTL_MS = 72 * 60 * 60 * 1000;
export const MAX_PENDING_APPROVALS = 200;
/** An approved request that never recorded an outcome (the process died mid-run) is closed after this long. */
export const STUCK_APPROVAL_MS = 15 * 60 * 1000;

export function approvalInputHash(toolName: string, input: unknown): string {
  return hashCanonical({ tool: toolName, input: input ?? null });
}

/** Field NAMES only — values stay in inputJson, not in the one-line summary. */
export function summarise(toolName: string, input: unknown): string {
  const fields =
    input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input as object).slice(0, 12) : [];
  return fields.length ? `${toolName} (${fields.join(", ")})` : toolName;
}

export async function requestApproval(args: {
  identityId: string;
  correlationId: string;
  toolName: string;
  input: unknown;
}): Promise<{ approvalId: string; created: boolean }> {
  const inputHash = approvalInputHash(args.toolName, args.input);
  const now = new Date();

  const existing = await prisma.agentApprovalRequest.findFirst({
    where: {
      identityId: args.identityId,
      toolName: args.toolName,
      inputHash,
      status: "pending",
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (existing) return { approvalId: existing.id, created: false };

  const pending = await prisma.agentApprovalRequest.count({
    where: { identityId: args.identityId, status: "pending", expiresAt: { gt: now } },
  });
  if (pending >= MAX_PENDING_APPROVALS) {
    throw new AgentHttpError("rate_limited", "Too many requests are already waiting for approval.", 429);
  }

  const row = await prisma.agentApprovalRequest.create({
    data: {
      identityId: args.identityId,
      correlationId: args.correlationId,
      toolName: args.toolName,
      inputJson: JSON.parse(JSON.stringify(args.input ?? null)) as Prisma.InputJsonValue,
      inputHash,
      summary: summarise(args.toolName, args.input),
      status: "pending",
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
    },
    select: { id: true },
  });
  return { approvalId: row.id, created: true };
}

// ── who may approve ─────────────────────────────────────────────────────────

/**
 * Setting `agent_approvers` (JSON): { "roles": ["admin"], "userIds": ["<user id>"] }.
 * A person may decide a request if their role is listed OR their id is listed.
 * Unset, malformed or empty means admins only. The "ai_agent" role is never an
 * approver, whatever the setting says: the AI cannot approve its own requests.
 */
export const APPROVERS_SETTING_KEY = "agent_approvers";
export const AGENT_ROLE_NAME = "ai_agent";

export type ApproverConfig = { roles: string[]; userIds: string[] };
export const DEFAULT_APPROVERS: ApproverConfig = { roles: ["admin"], userIds: [] };

const defaultApprovers = (): ApproverConfig => ({ roles: [...DEFAULT_APPROVERS.roles], userIds: [] });

const stringList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()))]
    : [];

export function parseApproverConfig(raw: unknown): ApproverConfig {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return defaultApprovers();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultApprovers();
  const o = value as Record<string, unknown>;
  const roles = stringList(o.roles).filter((r) => r !== AGENT_ROLE_NAME);
  const userIds = stringList(o.userIds);
  // Nobody listed would lock everyone out: fall back to the default instead.
  if (!roles.length && !userIds.length) return defaultApprovers();
  return { roles, userIds };
}

export function canApprove(user: { id: string; role: string } | null | undefined, cfg: ApproverConfig): boolean {
  if (!user || user.role === AGENT_ROLE_NAME) return false;
  return cfg.roles.includes(user.role) || cfg.userIds.includes(user.id);
}

const APPROVERS_TTL_MS = 15_000;
let approversCache: { at: number; value: ApproverConfig } | null = null;

export function resetApproverCache(): void {
  approversCache = null;
}

export async function loadApproverConfig(): Promise<ApproverConfig> {
  if (approversCache && Date.now() - approversCache.at < APPROVERS_TTL_MS) return approversCache.value;
  const row = await prisma.setting.findUnique({ where: { key: APPROVERS_SETTING_KEY } });
  const value = parseApproverConfig(row?.value);
  approversCache = { at: Date.now(), value };
  return value;
}

export async function isApprover(user: { id: string; role: string } | null | undefined): Promise<boolean> {
  if (!user || user.role === AGENT_ROLE_NAME) return false;
  return canApprove(user, await loadApproverConfig());
}

// ── deciding ────────────────────────────────────────────────────────────────

export type ApprovalRow = {
  id: string;
  identityId: string;
  correlationId: string;
  toolName: string;
  inputJson: unknown;
  inputHash: string;
  summary: string;
  status: string;
  requestedAt: Date;
  expiresAt: Date;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  executedAt: Date | null;
  resultJson: unknown;
  failureReason: string | null;
};

export type ClaimFailure = "not_found" | "not_pending" | "expired";
export type ClaimResult = { ok: true; request: ApprovalRow } | { ok: false; reason: ClaimFailure };

/**
 * Atomically move ONE pending, unexpired request to `to`. The WHERE clause is the
 * lock: of two simultaneous clicks exactly one updates a row, the other gets
 * count 0 and is told it was already decided. Nothing else can approve a row.
 */
async function claim(args: {
  id: string;
  to: "approved" | "rejected";
  deciderUserId: string;
  note: string | null;
}): Promise<ClaimResult> {
  const now = new Date();
  const res = await prisma.agentApprovalRequest.updateMany({
    where: { id: args.id, status: "pending", expiresAt: { gt: now } },
    data: { status: args.to, decidedByUserId: args.deciderUserId, decidedAt: now, decisionNote: args.note },
  });
  const row = (await prisma.agentApprovalRequest.findUnique({ where: { id: args.id } })) as ApprovalRow | null;
  if (!row) return { ok: false, reason: "not_found" };
  if (res.count === 1) return { ok: true, request: row };
  if (row.status === "expired" || (row.status === "pending" && row.expiresAt.getTime() <= now.getTime())) {
    return { ok: false, reason: "expired" };
  }
  return { ok: false, reason: "not_pending" };
}

export const claimApproval = (args: { id: string; approverUserId: string; note: string | null }) =>
  claim({ id: args.id, to: "approved", deciderUserId: args.approverUserId, note: args.note });

export const claimRejection = (args: { id: string; approverUserId: string; note: string | null }) =>
  claim({ id: args.id, to: "rejected", deciderUserId: args.approverUserId, note: args.note });

// ── expiry ──────────────────────────────────────────────────────────────────

/**
 * Daily sweep (see sweepAll in src/lib/cron-runner.ts). Pending requests past
 * their expiry become "expired"; an approved request that never recorded an
 * outcome is closed as failed so it does not look like it is still running.
 * The approve step itself also refuses expired rows, so this only tidies the list.
 */
export async function expireStaleApprovals(now: Date = new Date()): Promise<{ expired: number; closed: number }> {
  const expired = await prisma.agentApprovalRequest.updateMany({
    where: { status: "pending", expiresAt: { lte: now } },
    data: { status: "expired", failureReason: "Nobody decided in time." },
  });
  const closed = await prisma.agentApprovalRequest.updateMany({
    where: {
      status: "approved",
      executedAt: null,
      failureReason: null,
      decidedAt: { lt: new Date(now.getTime() - STUCK_APPROVAL_MS) },
    },
    data: {
      status: "failed",
      failureReason: "Stopped before it finished. It was not repeated; check the result before asking again.",
    },
  });
  return { expired: expired.count, closed: closed.count };
}

// ── what the agent may see of its own requests ──────────────────────────────

export type AgentApprovalView = {
  id: string;
  tool: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  executedAt: string | null;
  failureReason: string | null;
  result: unknown;
};

/** The stored result of the executed action, replaced by a marker when it is too big to return. */
function resultForAgent(resultJson: unknown): unknown {
  if (resultJson === null || resultJson === undefined) return null;
  return JSON.stringify(resultJson).length <= 8000 ? resultJson : { truncated: true };
}

export function toAgentView(row: ApprovalRow): AgentApprovalView {
  // A pending row past its expiry is already as good as expired; say so before the sweep runs.
  const status = row.status === "pending" && row.expiresAt.getTime() <= Date.now() ? "expired" : row.status;
  return {
    id: row.id,
    tool: row.toolName,
    status,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionNote: row.decisionNote,
    executedAt: row.executedAt ? row.executedAt.toISOString() : null,
    failureReason: row.failureReason,
    result: resultForAgent(row.resultJson),
  };
}

/** Only the identity that made the request can read it; anyone else gets null (a 404, never a hint it exists). */
export async function getApprovalForIdentity(identityId: string, id: string): Promise<AgentApprovalView | null> {
  const row = (await prisma.agentApprovalRequest.findUnique({ where: { id } })) as ApprovalRow | null;
  if (!row || row.identityId !== identityId) return null;
  return toAgentView(row);
}
