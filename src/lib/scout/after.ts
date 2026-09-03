import "server-only";

import { waitUntil } from "@vercel/functions";

/**
 * Run work *after* the response has been sent.
 *
 * ## Why this file exists
 *
 * Four route handlers return `202 Accepted` immediately and do the expensive
 * part — a scan slice, a Chromium report render, a comparison render, a review
 * extraction — once the client already has its response. On Next.js 15 that was
 * `after()` from `next/server`.
 *
 * **Next.js 14.2 has no `after()`, and no `unstable_after` either.** It first
 * appeared in 15.0 and stabilised in 15.1. Downgrading to 14.2 removes the API
 * outright, so this module supplies it.
 *
 * ## What it does instead
 *
 * On Vercel, `after()` is a thin wrapper over the platform's `waitUntil`, which
 * tells the runtime to keep the function alive until the promise settles even
 * though the response has gone. `@vercel/functions` exposes that same primitive
 * directly and works on 14.2, so on Vercel the behaviour is unchanged: the
 * response is immediate and the work still gets its `maxDuration`.
 *
 * ## The fallback matters
 *
 * `waitUntil` finds the platform request context through a global symbol. Off
 * Vercel — `next dev`, `next start` on a plain Node server, a test — that
 * context does not exist and `@vercel/functions` silently does **nothing**. Not
 * "runs it inline"; nothing. Dropping the callback there would mean scans that
 * never start in local development and a maintainer chasing a bug that only
 * exists off-platform, so this checks for the context first and otherwise runs
 * the callback as a floating promise. A long-lived local server has no reason
 * to kill it, which is what `next dev` did under `after()` anyway.
 *
 * ## Errors
 *
 * Swallowed and logged, as `after()` did. By the time this runs the response
 * has been sent, so there is nobody left to raise to — and every caller already
 * records its own outcome on the row it is working on. An unhandled rejection
 * here would take down the process instead.
 */

/** Vercel publishes its per-request context on this well-known symbol. */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

function hasPlatformContext(): boolean {
  const holder = globalThis as Record<symbol, { get?: () => unknown } | undefined>;
  const context = holder[REQUEST_CONTEXT]?.get?.();
  return (
    typeof context === "object" &&
    context !== null &&
    typeof (context as { waitUntil?: unknown }).waitUntil === "function"
  );
}

export function after(work: (() => Promise<unknown> | unknown) | Promise<unknown>): void {
  let promise: Promise<unknown>;
  try {
    promise = Promise.resolve(typeof work === "function" ? work() : work);
  } catch (error) {
    // A synchronous throw before the first await.
    console.error("[after] deferred work threw synchronously", error);
    return;
  }

  const guarded = promise.catch((error: unknown) => {
    console.error("[after] deferred work failed", error);
  });

  if (hasPlatformContext()) {
    waitUntil(guarded);
    return;
  }

  // Off-platform: keep the promise alive ourselves. `void` is deliberate — the
  // rejection is already handled above, so this cannot become an unhandled one.
  void guarded;
}
