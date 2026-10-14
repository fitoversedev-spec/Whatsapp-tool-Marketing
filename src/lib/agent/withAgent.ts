import "server-only";

import type { z } from "zod/v4";
import { requestApproval } from "./approvals";
import { writeAgentAudit, type AuditResult } from "./audit";
import { serverEnvironment, type AgentContext, type AgentCredentialMeta } from "./context";
import {
  AgentHttpError,
  buildErrorBody,
  DEFAULT_STATUS,
  errorResponse,
  jsonResponse,
  resolveCorrelationId,
  type AgentErrorCode,
} from "./errors";
import {
  beginIdempotent,
  completeIdempotent,
  failIdempotent,
  hashRequest,
  validateIdempotencyKey,
} from "./idempotency";
import { verifyCredential } from "./keys";
import { getEffectiveVerdict, TOOL_REGISTRY } from "./permissions";
import { checkRateLimit } from "./ratelimit";

/**
 * The one door into the agent API. Every route under src/app/api/agent/v1/**
 * (except the two public ones) is `export const GET = withAgent(...)`, so none
 * of them can forget authentication, permissions, rate limits, idempotency or
 * the audit row.
 *
 * Order:
 *   1  correlation id (echoed on every response)
 *   2  verifyCredential            -> 401, always the same generic body
 *   3  permission verdict          -> NEVER: 403 never_allowed
 *   4  rate limit                  -> 429 + Retry-After
 *   5  Idempotency-Key header      (mutating tools) -> 400 if missing/bad
 *   6  read + Zod-validate input   -> 400 (an invalid request never claims a key)
 *      APPROVAL verdict            -> queue an approval, 202 { approvalId, status }
 *   7  idempotency claim           (mutating) replay / 422 / 409 / go
 *   8  run the handler, 25 s limit
 *   9  exactly one audit row, in `finally`
 *
 * Two deliberate departures from a naive reading of the spec, both to keep a
 * compromised key from doing damage: rate limiting runs BEFORE an approval
 * request is created (so a flood can't bury the approvers), and validation runs
 * before the idempotency claim (so a malformed request never burns a key).
 */

export const HANDLER_TIMEOUT_MS = 25_000;
const MAX_BODY_BYTES = 256 * 1024;
export type AgentHandlerResult = {
  /** Default 200. */
  status?: number;
  body: unknown;
  /** Defaults to the tool's registered action (read/create/update/send/delete). */
  action?: string;
  /** Ids of the records touched. Ids only — never contents. */
  recordIds?: string[];
  /** Names of the fields changed. Names only — never values. */
  fieldsChanged?: string[];
};

export type AgentHandlerArgs<I> = {
  ctx: AgentContext;
  meta: AgentCredentialMeta;
  input: I;
  req: Request;
  params: Record<string, string>;
  idempotencyKey: string | null;
};

export type AgentHandler<I> = (args: AgentHandlerArgs<I>) => Promise<AgentHandlerResult>;

export type WithAgentOptions<I> = {
  /** True for anything that changes state: requires Idempotency-Key, fails closed on audit errors. */
  mutating: boolean;
  /** Validates the JSON body (POST/PUT/PATCH/DELETE) or the query string (GET). */
  inputSchema?: z.ZodType<I>;
};

type AuditState = {
  identityId: string | null;
  credentialId: string | null;
  environment: string;
  ip: string | null;
  action: string;
  recordIds: string[];
  fieldsChanged: string[] | null;
  approvalId: string | null;
  failureReason: string | null;
  result: AuditResult;
  httpStatus: number;
  idempotencyKey: string | null;
  /** A write happened (or an approval was queued): an audit failure must now fail the request. */
  stateChanged: boolean;
};

class HandlerTimeout extends Error {
  constructor() {
    super("handler timed out");
    this.name = "HandlerTimeout";
  }
}

export function resultForCode(code: AgentErrorCode): AuditResult {
  switch (code) {
    case "unauthorized":
    case "forbidden":
    case "never_allowed":
      return "denied";
    case "invalid_input":
    case "idempotency_conflict":
    case "not_found":
      return "invalid";
    case "rate_limited":
      return "rate_limited";
    case "approval_required":
      return "pending_approval";
    default:
      return "error";
  }
}

export function resultForStatus(status: number): AuditResult {
  if (status < 400) return "success";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "denied";
  if (status < 500) return "invalid";
  return "error";
}

/** Class name (+ Prisma/DB code) only: error messages can echo query arguments, i.e. customer data. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "UnknownError";
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? `${err.name}:${code}` : err.name;
}

async function readInput(
  req: Request,
  url: URL,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  if (req.method === "GET" || req.method === "HEAD") {
    return { ok: true, value: Object.fromEntries(url.searchParams.entries()) };
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { ok: false, message: "Request body is too large." };
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, message: "Request body is too large." };
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
}

function sortedQuery(url: URL): string {
  return new URLSearchParams([...url.searchParams.entries()].sort()).toString();
}

export function withAgent<I = unknown>(toolName: string, handler: AgentHandler<I>, options: WithAgentOptions<I>) {
  const { mutating, inputSchema } = options;
  const defaultAction = Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, toolName)
    ? TOOL_REGISTRY[toolName].action
    : "unknown";

  return async function agentRoute(req: Request, routeCtx?: { params?: Record<string, string> }): Promise<Response> {
    const started = Date.now();
    const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"));
    const url = new URL(req.url);
    const state: AuditState = {
      identityId: null,
      credentialId: null,
      environment: serverEnvironment() ?? "unknown",
      ip: null,
      action: defaultAction,
      recordIds: [],
      fieldsChanged: null,
      approvalId: null,
      failureReason: null,
      result: "error",
      httpStatus: 500,
      idempotencyKey: null,
      stateChanged: false,
    };

    const fail = (
      code: AgentErrorCode,
      message: string,
      opts?: { result?: AuditResult; status?: number; headers?: Record<string, string>; reason?: string },
    ): Response => {
      const status = opts?.status ?? DEFAULT_STATUS[code];
      state.result = opts?.result ?? resultForCode(code);
      state.httpStatus = status;
      state.failureReason = opts?.reason ?? code;
      return errorResponse(code, message, correlationId, { status, headers: opts?.headers });
    };

    const execute = async (): Promise<Response> => {
      // 2. Who is calling?
      const verified = await verifyCredential(req.headers);
      state.ip = verified.ok ? verified.context.ip : verified.ip;
      if (!verified.ok) {
        if (verified.identityId) {
          state.identityId = verified.identityId;
          state.credentialId = verified.credentialId ?? null;
          state.environment = verified.environment ?? state.environment;
        } else {
          // Nobody to attribute it to: logged, not written to the database, so
          // an anonymous caller can't make us store rows.
          console.warn(
            JSON.stringify({
              event: "agent_auth_denied",
              reason: verified.reason,
              ip: verified.ip,
              route: url.pathname,
              correlationId,
            }),
          );
        }
        if (verified.reason === "server_misconfigured") {
          console.error("[agent] AGENT_API_ENV is not set to development|staging|production; refusing all keys");
        }
        return fail("unauthorized", "Missing, invalid, expired or revoked credentials.", {
          result: "denied",
          headers: { "WWW-Authenticate": 'Bearer realm="fitoverse-agent"' },
          reason: `auth:${verified.reason}`,
        });
      }

      const ctx: AgentContext = { ...verified.context, correlationId };
      state.identityId = ctx.identityId;
      state.credentialId = ctx.credentialId;
      state.environment = ctx.environment;

      // 3. May this tool run at all?
      const verdict = await getEffectiveVerdict(toolName);
      if (verdict === "NEVER") {
        return fail("never_allowed", "This tool is not permitted for the AI agent.", { reason: "verdict:NEVER" });
      }

      // 4. Rate limit.
      const rate = await checkRateLimit(ctx.identityId, toolName);
      if (!rate.allowed) {
        return fail("rate_limited", "Rate limit exceeded. Retry after the delay in Retry-After.", {
          headers: { "Retry-After": String(rate.retryAfterSec) },
          reason: `rate:${rate.scope}`,
        });
      }

      // 5. Idempotency-Key header.
      let idempotencyKey: string | null = null;
      if (mutating) {
        idempotencyKey = validateIdempotencyKey(req.headers.get("idempotency-key"));
        if (!idempotencyKey) {
          return fail(
            "invalid_input",
            "A valid Idempotency-Key header is required (8-128 characters: letters, digits, . _ : -).",
            { reason: "idempotency_key_invalid" },
          );
        }
        state.idempotencyKey = idempotencyKey;
      }

      // 6. Read and validate the input.
      const read = await readInput(req, url);
      if (!read.ok) return fail("invalid_input", read.message, { reason: "body_unreadable" });
      let input = read.value as I;
      if (inputSchema) {
        const parsed = inputSchema.safeParse(read.value);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.length ? i.path.join(".") : "(body)"}: ${i.message}`)
            .join("; ");
          return fail("invalid_input", `Invalid input. ${issues}`.slice(0, 400), { reason: "validation" });
        }
        input = parsed.data;
      }

      // 6b. A human has to say yes first.
      if (verdict === "APPROVAL") {
        const { approvalId } = await requestApproval({
          identityId: ctx.identityId,
          correlationId,
          toolName,
          input,
        });
        state.stateChanged = true;
        state.approvalId = approvalId;
        state.result = "pending_approval";
        state.httpStatus = 202;
        return jsonResponse({ approvalId, status: "pending" }, 202, correlationId);
      }

      // 7. Claim the idempotency key.
      if (mutating && idempotencyKey) {
        const begin = await beginIdempotent(
          ctx.identityId,
          idempotencyKey,
          hashRequest({ method: req.method, path: url.pathname, query: sortedQuery(url), body: read.value }),
        );
        if (begin.kind === "replay") {
          state.action = `replay:${defaultAction}`;
          state.result = resultForStatus(begin.status);
          state.httpStatus = begin.status;
          return jsonResponse(begin.body, begin.status, correlationId, { "Idempotent-Replay": "true" });
        }
        if (begin.kind === "conflict") {
          return fail("idempotency_conflict", "This Idempotency-Key was already used with a different request.", {
            status: 422,
            reason: "idempotency_conflict",
          });
        }
        if (begin.kind === "in_progress") {
          return fail("idempotency_conflict", "A request with this Idempotency-Key is still in progress.", {
            result: "denied",
            status: 409,
            headers: { "Retry-After": String(begin.retryAfterSec) },
            reason: "idempotency_in_progress",
          });
        }
      }

      // 8. Run the handler.
      state.stateChanged = mutating;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finalize = async (status: number, body: unknown, retryable: boolean) => {
        if (!mutating || !idempotencyKey) return;
        try {
          if (retryable) await failIdempotent(ctx.identityId, idempotencyKey);
          else await completeIdempotent(ctx.identityId, idempotencyKey, status, body);
        } catch (error) {
          // The work is done; do not turn that into an error for the caller. Worst
          // case the lease expires and a retry runs again, which is why mutating
          // handlers must also be safe to repeat.
          console.error("[agent] could not record idempotency outcome", { correlationId, error: describeError(error) });
        }
      };

      try {
        const result = await Promise.race([
          handler({
            ctx,
            meta: verified.meta,
            input,
            req,
            params: routeCtx?.params ?? {},
            idempotencyKey,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new HandlerTimeout()), HANDLER_TIMEOUT_MS);
          }),
        ]);
        const status = result.status ?? 200;
        state.action = result.action ?? defaultAction;
        state.recordIds = result.recordIds ?? [];
        state.fieldsChanged = result.fieldsChanged ?? null;
        state.httpStatus = status;
        state.result = resultForStatus(status);
        await finalize(status, result.body, status >= 500);
        return jsonResponse(result.body, status, correlationId);
      } catch (err) {
        if (err instanceof AgentHttpError) {
          const body = buildErrorBody(err.code, err.message, correlationId);
          state.httpStatus = err.status;
          state.result = resultForCode(err.code);
          state.failureReason = err.code;
          await finalize(err.status, body, err.status >= 500);
          return jsonResponse(body, err.status, correlationId);
        }
        if (err instanceof HandlerTimeout) {
          // The handler may still be running. Leave the idempotency lease in
          // place so a retry waits it out instead of racing the first attempt.
          state.httpStatus = 504;
          state.result = "error";
          state.failureReason = "handler_timeout";
          return errorResponse("internal", "The request timed out.", correlationId, { status: 504 });
        }
        console.error("[agent] handler failed", { correlationId, toolName, error: err });
        state.httpStatus = 500;
        state.result = "error";
        state.failureReason = describeError(err);
        await finalize(500, null, true);
        return errorResponse("internal", "Internal error.", correlationId);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    let response!: Response;
    try {
      response = await execute();
    } catch (err) {
      console.error("[agent] request failed", { correlationId, toolName, error: err });
      state.httpStatus = 500;
      state.result = "error";
      state.failureReason = describeError(err);
      response = errorResponse("internal", "Internal error.", correlationId);
    } finally {
      // 9. Exactly one audit row — when we know whose request it was.
      if (state.identityId) {
        try {
          await writeAgentAudit(
            {
              correlationId,
              identityId: state.identityId,
              credentialId: state.credentialId,
              environment: state.environment,
              toolName,
              httpMethod: req.method,
              route: url.pathname,
              ip: state.ip,
              recordIds: state.recordIds,
              action: state.action,
              result: state.result,
              httpStatus: state.httpStatus,
              fieldsChanged: state.fieldsChanged,
              approvalId: state.approvalId,
              failureReason: state.failureReason,
              durationMs: Date.now() - started,
              idempotencyKey: state.idempotencyKey,
            },
            { mutating: state.stateChanged },
          );
        } catch {
          // A change was made and cannot be accounted for: fail closed. A retry
          // with the same Idempotency-Key replays the stored result (and is audited).
          response = errorResponse(
            "internal",
            "The action could not be recorded. Retry with the same Idempotency-Key.",
            correlationId,
          );
        }
      }
    }
    return response;
  };
}
