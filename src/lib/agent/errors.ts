import { randomUUID } from "node:crypto";

/**
 * One error shape for the whole agent API:
 *   { "error": { "code": "...", "message": "...", "correlationId": "..." } }
 * The code is stable and machine-readable; the message is short and written for
 * a developer. Neither ever carries a stack trace, SQL, file path or secret.
 */
export const AGENT_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "never_allowed",
  "approval_required",
  "rate_limited",
  "invalid_input",
  "idempotency_conflict",
  "not_found",
  "internal",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const DEFAULT_STATUS: Record<AgentErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  never_allowed: 403,
  approval_required: 202,
  rate_limited: 429,
  invalid_input: 400,
  idempotency_conflict: 422,
  not_found: 404,
  internal: 500,
};

export type AgentErrorBody = {
  error: { code: AgentErrorCode; message: string; correlationId: string };
};

export function buildErrorBody(code: AgentErrorCode, message: string, correlationId: string): AgentErrorBody {
  return { error: { code, message, correlationId } };
}

/** Throw from a handler to return a controlled, non-5xx error to the caller. */
export class AgentHttpError extends Error {
  readonly code: AgentErrorCode;
  readonly status: number;
  constructor(code: AgentErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AgentHttpError";
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code];
  }
}

const CORRELATION_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** The caller's X-Correlation-Id if it is safe to echo, else a fresh UUID. */
export function resolveCorrelationId(header: string | null | undefined): string {
  return header && CORRELATION_RE.test(header) ? header : randomUUID();
}

/** Common headers on every agent response. */
export function baseHeaders(correlationId: string, extra?: Record<string, string>): Headers {
  const h = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Correlation-Id": correlationId,
  });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

export function jsonResponse(
  body: unknown,
  status: number,
  correlationId: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders(correlationId, extraHeaders) });
}

export function errorResponse(
  code: AgentErrorCode,
  message: string,
  correlationId: string,
  opts?: { status?: number; headers?: Record<string, string> },
): Response {
  return jsonResponse(
    buildErrorBody(code, message, correlationId),
    opts?.status ?? DEFAULT_STATUS[code],
    correlationId,
    opts?.headers,
  );
}
