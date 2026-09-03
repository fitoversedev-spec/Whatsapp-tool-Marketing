"use client";

/**
 * The network layer for Field mode.
 *
 * Written for a phone on one bar of 3G at the edge of a plot, which is the
 * condition this product is actually used in:
 *
 * - **Long timeouts.** 25 s, not the 5 s a desktop app would pick. A request
 *   that would have succeeded in 8 s and was aborted at 5 costs a scan.
 * - **Retries only what is safe.** GETs retry with backoff; a POST or PUT is
 *   attempted exactly once, because "did that save?" is a question the surveyor
 *   must never have to ask twice about the same observation.
 * - **Stale is labelled, never disguised.** When the service worker answers
 *   from cache it stamps `X-SS-Cached-At`. `staleAt` carries that up to the UI,
 *   which is required to say so. Competitor data presented as current when it
 *   is four days old is worse than an error.
 */

/** Header the service worker stamps on a cache-served response. */
export const CACHE_DATE_HEADER = "X-SS-Cached-At";

export const DEFAULT_TIMEOUT_MS = 25_000;

export interface ApiResult<T> {
  readonly data: T;
  /** When the service worker cached this, or `null` for a live response. */
  readonly staleAt: Date | null;
  readonly status: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    /** True when nothing reached the server — retrying may well work. */
    readonly offline = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  /** Retries for idempotent reads. Writes are never retried. */
  retries?: number;
  signal?: AbortSignal;
}

function isIdempotent(method: string): boolean {
  return method === "GET";
}

async function readError(response: Response): Promise<{ message: string; code: string | null }> {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    return { message: body.error ?? response.statusText, code: body.code ?? null };
  } catch {
    return { message: response.statusText || `Request failed (${response.status})`, code: null };
  }
}

/**
 * One request, with a timeout, backoff on transient failures and stale
 * detection.
 */
export async function apiFetch<T>(url: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = isIdempotent(method) ? 1 + (options.retries ?? 2) : 1;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onOuterAbort);

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // The cache decision belongs to the service worker, not to the HTTP cache.
        cache: "no-store",
      });

      if (!response.ok) {
        const { message, code } = await readError(response);
        // 5xx on a read is worth another go; 4xx never is.
        if (response.status >= 500 && attempt < maxAttempts - 1) {
          lastError = new ApiError(message, response.status, code);
          continue;
        }
        throw new ApiError(message, response.status, code);
      }

      const cachedAt = response.headers.get(CACHE_DATE_HEADER);
      const staleAt = cachedAt ? new Date(cachedAt) : null;
      const data = (response.status === 204 ? null : await response.json()) as T;

      return {
        data,
        staleAt: staleAt && !Number.isNaN(staleAt.getTime()) ? staleAt : null,
        status: response.status,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error;
      if (options.signal?.aborted) throw error;
      if (attempt < maxAttempts - 1) {
        // Full jitter, so a cell tower coming back does not get a thundering herd.
        const backoff = Math.min(4_000, 400 * 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, Math.random() * backoff));
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  const aborted = lastError instanceof DOMException && lastError.name === "AbortError";
  throw new ApiError(
    aborted
      ? "The network did not answer in time. Move to better signal and try again."
      : "Could not reach Site Scout. Check your signal and try again.",
    0,
    aborted ? "TIMEOUT" : "OFFLINE",
    true,
  );
}
