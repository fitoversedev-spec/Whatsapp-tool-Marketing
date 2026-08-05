// Typed error for the AI layer so API routes can map failures to friendly
// HTTP responses instead of leaking raw SDK errors to the client.
export type AiErrorCode = "not_configured" | "no_credit" | "limit" | "refusal" | "failed";

export class AiError extends Error {
  code: AiErrorCode;
  constructor(message: string, code: AiErrorCode) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

// Map an AiError code to an HTTP status for route handlers.
export function aiErrorStatus(code: AiErrorCode): number {
  switch (code) {
    case "not_configured":
      return 503;
    case "no_credit":
      return 402; // Payment Required — the AI balance is exhausted.
    case "limit":
      return 429;
    default:
      return 500;
  }
}

// Turn a raw Anthropic SDK error into a typed AiError so callers can surface a
// clear, actionable message — most importantly "credit ran out" and "bad key" —
// instead of a generic 500. Anything unrecognised falls through to "failed".
export function mapAnthropicError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  const status = (e as { status?: number })?.status;
  const message = ((e as { message?: string })?.message || "").toLowerCase();
  if (
    message.includes("credit balance") ||
    message.includes("billing") ||
    message.includes("insufficient")
  ) {
    return new AiError(
      "The AI credit has run out — top up your Anthropic balance to keep using AI.",
      "no_credit",
    );
  }
  if (status === 401 || message.includes("invalid api key") || message.includes("authentication")) {
    return new AiError("The AI key looks invalid — check the ANTHROPIC_API_KEY.", "not_configured");
  }
  return new AiError("The AI request failed — please try again in a moment.", "failed");
}
