// Time limits for calls to outside services (Meta, Google, Anthropic, Resend…).
// Vercel Hobby kills a function at 60 s with no message, so every outside call
// gets its own shorter limit and fails with a readable error instead.

export class UpstreamTimeoutError extends Error {
  service: string;
  ms: number;
  constructor(service: string, ms: number) {
    super(`${service} didn't respond within ${Math.round(ms / 1000)} s`);
    this.name = "UpstreamTimeoutError";
    this.service = service;
    this.ms = ms;
  }
}

// True for our own timeout, a fetch/AbortSignal timeout, and axios/Node
// timeout codes — so callers can treat "slow" differently from "refused".
export function isTimeoutError(e: unknown): boolean {
  if (e instanceof UpstreamTimeoutError) return true;
  const err = e as { name?: string; code?: string; cause?: { name?: string; code?: string } } | null;
  const names = [err?.name, err?.cause?.name];
  const codes = [err?.code, err?.cause?.code];
  return (
    names.includes("TimeoutError") ||
    codes.includes("ECONNABORTED") ||
    codes.includes("ETIMEDOUT") ||
    codes.includes("UND_ERR_CONNECT_TIMEOUT") ||
    codes.includes("UND_ERR_HEADERS_TIMEOUT")
  );
}

// A body read after fetchT shares its timer; when that fires mid-read the error
// is a plain TimeoutError. Convert it so callers see one error type.
export function toTimeoutError(e: unknown, service: string, ms: number): unknown {
  return isTimeoutError(e) && !(e instanceof UpstreamTimeoutError)
    ? new UpstreamTimeoutError(service, ms)
    : e;
}

// fetch with a time limit. Honours a caller-supplied signal too. A timeout
// throws UpstreamTimeoutError; any other failure is passed through unchanged.
export async function fetchT(
  service: string,
  url: string | URL,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(ms);
  let signal: AbortSignal = timeoutSignal;
  if (init?.signal) {
    const ctrl = new AbortController();
    const relay = () => ctrl.abort();
    for (const s of [init.signal, timeoutSignal]) {
      if (s.aborted) relay();
      else s.addEventListener("abort", relay, { once: true });
    }
    signal = ctrl.signal;
  }
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    if (timeoutSignal.aborted) throw new UpstreamTimeoutError(service, ms);
    throw e;
  }
}

// Race any promise against a timer. The underlying work can't be cancelled, so
// use fetchT / SDK timeouts where possible and this for libraries without one.
export function withTimeout<T>(promise: Promise<T>, ms: number, service: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamTimeoutError(service, ms)), ms);
  });
  // The loser may reject later; keep that from surfacing as an unhandled rejection.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A shared time budget for a multi-step job (tool loops, pagination).
export function deadline(totalMs: number): { remaining: () => number } {
  const end = Date.now() + totalMs;
  return { remaining: () => Math.max(0, end - Date.now()) };
}
