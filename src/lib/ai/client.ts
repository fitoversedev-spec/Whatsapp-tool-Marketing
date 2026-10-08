// Server-only Anthropic client + the model both AI features run on.
// Sonnet 5 = strong instruction-following (template drafting) and tool use
// (analytics) at a fraction of flagship cost. The key is read from the
// ANTHROPIC_API_KEY env var and NEVER exposed to the browser.
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "./errors";

export const AI_MODEL = "claude-sonnet-5";

// Vercel Hobby kills a function at 60 s, so every AI call needs its own limit.
// A single call gets 25 s + one retry (worst case ~51 s); tool loops share an
// overall budget and never retry (see tools.ts / scout analysis engine).
export const AI_SINGLE_TIMEOUT_MS = 25_000;
export const AI_LOOP_TOTAL_MS = 50_000;

// Routes with a shorter maxDuration (e.g. 30 s) wrap their AI call in
// withAiBudget(22_000, …): single calls then use that as their timeout with no
// retry, and tool loops use it as their overall deadline.
const budgetStore = new AsyncLocalStorage<number>();
export function withAiBudget<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return budgetStore.run(ms, fn);
}
export function aiBudgetMs(): number | undefined {
  return budgetStore.getStore();
}
export function singleCallOptions(): { timeout: number; maxRetries: number } {
  const budget = aiBudgetMs();
  return budget
    ? { timeout: budget, maxRetries: 0 }
    : { timeout: AI_SINGLE_TIMEOUT_MS, maxRetries: 1 };
}

let cached: Anthropic | null = null;

// True when the API key is present. Routes/UI can use this to show a
// "not configured yet" hint instead of erroring.
export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Returns a singleton Anthropic client. Throws a typed AiError (→ 503) when
// the key is missing so callers surface a clean message.
export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiError("AI is not configured yet — set ANTHROPIC_API_KEY", "not_configured");
  }
  if (!cached) cached = new Anthropic({ apiKey, timeout: AI_SINGLE_TIMEOUT_MS, maxRetries: 1 });
  return cached;
}
