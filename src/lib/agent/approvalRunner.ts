import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAgentAudit, redactSecrets, type AuditResult } from "./audit";
import {
  approvalInputHash,
  canApprove,
  claimApproval,
  claimRejection,
  loadApproverConfig,
  type ApprovalRow,
} from "./approvals";
import { serverEnvironment, type AgentContext } from "./context";
import { AgentHttpError } from "./errors";
import type { ApprovalExecutorResult } from "./executors";
import { getEffectiveVerdict, TOOL_REGISTRY } from "./permissions";
import { AREA_EXECUTORS } from "./registry";

/**
 * Decides and runs the AI's approval requests.
 *
 *  approve: approver check -> not the AI's own request -> atomic claim
 *           (pending & unexpired -> approved) -> tamper check -> executor, ONCE,
 *           with the stored input -> record executed/failed -> audit row.
 *  reject:  same checks, then pending -> rejected. Nothing runs.
 *
 * An approved action runs exactly the stored input and nothing else; there is no
 * way to edit it here. If no executor exists for the tool, the request stays
 * "approved" with a failureReason saying nothing was run.
 */
export const EXECUTOR_TIMEOUT_MS = 25_000;

export type DecisionRefusal = "not_approver" | "not_found" | "not_pending" | "expired" | "own_request";

export const REFUSAL_MESSAGES: Record<DecisionRefusal, string> = {
  not_approver: "You are not allowed to decide AI requests.",
  not_found: "This request was not found.",
  not_pending: "Someone has already decided this request.",
  expired: "This request has expired.",
  own_request: "The AI cannot decide its own requests.",
};

export const REFUSAL_HTTP_STATUS: Record<DecisionRefusal, number> = {
  not_approver: 403,
  not_found: 404,
  not_pending: 409,
  expired: 410,
  own_request: 403,
};

export type ApproveOutcome =
  | { ok: true; status: "executed" | "failed" | "approved"; failureReason: string | null; result: unknown }
  | { ok: false; code: DecisionRefusal; message: string };

export type RejectOutcome = { ok: true } | { ok: false; code: DecisionRefusal; message: string };

type Approver = { id: string; role: string };

const refuse = (code: DecisionRefusal): { ok: false; code: DecisionRefusal; message: string } => ({
  ok: false,
  code,
  message: REFUSAL_MESSAGES[code],
});

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const MAX_RESULT_CHARS = 20_000;

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const text = JSON.stringify(value);
  if (text.length > MAX_RESULT_CHARS) return { truncated: true };
  return JSON.parse(text) as Prisma.InputJsonValue;
}

function idsOf(r: ApprovalExecutorResult["recordIds"]): string[] {
  if (!r) return [];
  return Array.isArray(r) ? r : Object.values(r);
}

/** The refusal message inside an executor's 4xx body ({ error: { message } } and/or { reason }). */
function refusalText(status: number, body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as { error?: { message?: unknown; code?: unknown }; reason?: unknown };
  const message = typeof b.error?.message === "string" ? b.error.message : null;
  const code = typeof b.reason === "string" ? b.reason : typeof b.error?.code === "string" ? b.error.code : null;
  return clip(redactSecrets(message ? `${message}${code ? ` (${code})` : ""}` : `Refused (${status})`), 300);
}

async function audit(
  row: ApprovalRow,
  approverId: string,
  a: { action: string; result: AuditResult; httpStatus: number; failureReason?: string | null; recordIds?: string[]; startedAt: number; route: "approve" | "reject" },
): Promise<void> {
  try {
    await writeAgentAudit(
      {
        correlationId: row.correlationId,
        identityId: row.identityId,
        credentialId: null,
        environment: serverEnvironment() ?? "unknown",
        toolName: row.toolName,
        httpMethod: "POST",
        route: `/api/admin/agent/approvals/${row.id}/${a.route}`,
        ip: null,
        // The audit table has no approver column; the approver is named in recordIds.
        recordIds: [row.id, `approver:${approverId}`, ...(a.recordIds ?? [])],
        action: a.action,
        result: a.result,
        httpStatus: a.httpStatus,
        approvalId: row.id,
        failureReason: a.failureReason ?? null,
        durationMs: Date.now() - a.startedAt,
      },
      { mutating: false },
    );
  } catch (error) {
    console.error("[agent-approval] audit failed", { approvalId: row.id, error: (error as Error)?.name });
  }
}

type Identity = { id: string; userId: string; status: string };

async function loadIdentity(identityId: string): Promise<Identity | null> {
  return prisma.agentIdentity.findUnique({ where: { id: identityId }, select: { id: true, userId: true, status: true } });
}

/** Common gate for approve and reject. Returns the AI identity (may be null if it was removed). */
async function gate(
  id: string,
  approver: Approver,
): Promise<{ ok: true; identity: Identity | null } | { ok: false; code: DecisionRefusal }> {
  if (!canApprove(approver, await loadApproverConfig())) return { ok: false, code: "not_approver" };
  const peek = await prisma.agentApprovalRequest.findUnique({ where: { id }, select: { identityId: true } });
  if (!peek) return { ok: false, code: "not_found" };
  const identity = await loadIdentity(peek.identityId);
  if (identity && identity.userId === approver.id) return { ok: false, code: "own_request" };
  return { ok: true, identity };
}

export async function approveRequest(args: { id: string; approver: Approver; note: string | null }): Promise<ApproveOutcome> {
  const startedAt = Date.now();
  const g = await gate(args.id, args.approver);
  if (!g.ok) return refuse(g.code);

  const claimed = await claimApproval({ id: args.id, approverUserId: args.approver.id, note: args.note });
  if (!claimed.ok) return refuse(claimed.reason);

  return runApproved({ row: claimed.request, identity: g.identity, approverId: args.approver.id, startedAt });
}

export async function rejectRequest(args: { id: string; approver: Approver; note: string }): Promise<RejectOutcome> {
  const startedAt = Date.now();
  const g = await gate(args.id, args.approver);
  if (!g.ok) return refuse(g.code);

  const claimed = await claimRejection({ id: args.id, approverUserId: args.approver.id, note: args.note });
  if (!claimed.ok) return refuse(claimed.reason);

  await audit(claimed.request, args.approver.id, {
    action: "approval_rejected",
    result: "denied",
    httpStatus: 200,
    startedAt,
    route: "reject",
  });
  return { ok: true };
}

type Closing = {
  status: "executed" | "failed" | "approved";
  failureReason: string | null;
  result: unknown;
  action: string;
  auditResult: AuditResult;
  httpStatus: number;
  recordIds?: string[];
};

/** The request is already claimed ("approved"). Run the executor once and record what happened. */
export async function runApproved(args: {
  row: ApprovalRow;
  identity: Identity | null;
  approverId: string;
  startedAt?: number;
}): Promise<ApproveOutcome> {
  const { row, identity, approverId } = args;
  const startedAt = args.startedAt ?? Date.now();

  const close = async (c: Closing): Promise<ApproveOutcome> => {
    const data: Prisma.AgentApprovalRequestUpdateManyMutationInput = {
      status: c.status,
      failureReason: c.failureReason,
      ...(c.status === "executed" ? { executedAt: new Date() } : {}),
    };
    const json = toJson(c.result);
    if (json !== undefined) data.resultJson = json;
    // Only the row we claimed ("approved") is updated; nothing else can be touched.
    await prisma.agentApprovalRequest.updateMany({ where: { id: row.id, status: "approved" }, data });
    await audit(row, approverId, {
      action: c.action,
      result: c.auditResult,
      httpStatus: c.httpStatus,
      failureReason: c.failureReason,
      recordIds: c.recordIds,
      startedAt,
      route: "approve",
    });
    return { ok: true, status: c.status, failureReason: c.failureReason, result: c.result ?? null };
  };

  const stop = (reason: string, action: string, status: "failed" | "approved" = "failed", httpStatus = 409) =>
    close({ status, failureReason: reason, result: null, action, auditResult: "error", httpStatus });

  // 1. The stored input must still be exactly what was proposed.
  if (approvalInputHash(row.toolName, row.inputJson) !== row.inputHash) {
    return stop(
      "The saved request no longer matches what the AI asked for, so nothing was run.",
      "approval_tampered",
    );
  }

  // 2. Is there anything that can run it?
  const executor = Object.prototype.hasOwnProperty.call(AREA_EXECUTORS, row.toolName)
    ? AREA_EXECUTORS[row.toolName]
    : undefined;
  if (!executor) {
    return stop(
      "Approved, but this kind of request cannot be run automatically yet. Nothing was changed.",
      "approval_not_executable",
      "approved",
    );
  }

  // 3. Switched off since it was asked? Then it stays off. Tools that are NEVER
  // by design (e.g. approve_quote: only a person's approval can run it, the AI
  // can never call it) are not "switched off" — only an admin override is.
  const designedNever = TOOL_REGISTRY[row.toolName]?.default === "NEVER";
  if (!designedNever && (await getEffectiveVerdict(row.toolName)) === "NEVER") {
    return stop("This action has been turned off for the AI since it was asked, so it was not run.", "approval_blocked");
  }

  // 4. The AI identity it will run as.
  if (!identity || identity.status !== "active") {
    return stop("The AI account that made this request is no longer active, so it was not run.", "approval_blocked");
  }

  const ctx: AgentContext = {
    identityId: identity.id,
    userId: identity.userId,
    credentialId: `approval:${row.id}`,
    environment: serverEnvironment() ?? "development",
    correlationId: row.correlationId,
    ip: null,
  };

  // 5. Run it, once. There is no retry here: a second attempt is a new request from the AI.
  const fail = (reason: string, action: string, httpStatus: number): Closing => ({
    status: "failed",
    failureReason: reason,
    result: null,
    action,
    auditResult: "error",
    httpStatus,
  });
  let closing: Closing;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      executor({ ctx, input: row.inputJson, approvalId: row.id, approvedByUserId: approverId }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("executor_timeout")), EXECUTOR_TIMEOUT_MS);
      }),
    ]);
    const recordIds = idsOf(result.recordIds);
    closing =
      result.status >= 400
        ? {
            status: "failed",
            failureReason: refusalText(result.status, result.body),
            result: result.body,
            action: "approval_refused",
            auditResult: "error",
            httpStatus: result.status,
            recordIds,
          }
        : {
            status: "executed",
            failureReason: null,
            result: result.body,
            action: "approval_executed",
            auditResult: "success",
            httpStatus: result.status,
            recordIds,
          };
  } catch (err) {
    if (err instanceof AgentHttpError) {
      closing = fail(clip(redactSecrets(err.message), 300), "approval_refused", err.status);
    } else if (err instanceof Error && err.message === "executor_timeout") {
      closing = fail(
        "It took too long. It may or may not have gone through; check before asking again. It was not repeated.",
        "approval_timeout",
        504,
      );
    } else {
      console.error("[agent-approval] executor failed", { approvalId: row.id, toolName: row.toolName, error: err });
      closing = fail("Something went wrong while running it. It was not repeated.", "approval_error", 500);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  return close(closing);
}
