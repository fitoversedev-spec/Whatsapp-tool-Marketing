// Server-only Anthropic client + the model both AI features run on.
// Sonnet 5 = strong instruction-following (template drafting) and tool use
// (analytics) at a fraction of flagship cost. The key is read from the
// ANTHROPIC_API_KEY env var and NEVER exposed to the browser.
import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "./errors";

export const AI_MODEL = "claude-sonnet-5";

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
  if (!cached) cached = new Anthropic({ apiKey });
  return cached;
}
