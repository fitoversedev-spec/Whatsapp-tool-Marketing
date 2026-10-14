import { prisma } from "@/lib/prisma";
import { incrementBucket, secondsUntilNextWindow, windowStart } from "../ratelimit";

/**
 * Per-customer send limit: at most N messages (free-text and template together)
 * per conversation per hour, so a looping agent cannot spam one person.
 * N comes from Setting `agent_rate_limits` -> `perConversationHour` (default 10).
 * Counted with the stage-0 bucket table under scope `conv:<conversationId>`.
 */
export const DEFAULT_PER_CONVERSATION_HOUR = 10;
const MAX_PER_CONVERSATION_HOUR = 1000;
const HOUR_MS = 3_600_000;
const SETTING_KEY = "agent_rate_limits";

/** Pure: a stored JSON value -> the limit. Anything invalid falls back to the default. */
export function resolvePerConversationHour(stored: unknown): number {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return DEFAULT_PER_CONVERSATION_HOUR;
  const v = (stored as Record<string, unknown>).perConversationHour;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_PER_CONVERSATION_HOUR
    ? v
    : DEFAULT_PER_CONVERSATION_HOUR;
}

let cache: { at: number; value: number } | null = null;
export function resetConversationLimitCache(): void {
  cache = null;
}

export async function getPerConversationHour(): Promise<number> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  let stored: unknown = null;
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    stored = row?.value ? JSON.parse(row.value) : null;
  } catch {
    stored = null;
  }
  const value = resolvePerConversationHour(stored);
  cache = { at: Date.now(), value };
  return value;
}

export type ConversationCharge = { allowed: true } | { allowed: false; retryAfterSec: number; limit: number };

/** Count one outgoing message against the conversation's hourly budget. */
export async function chargeConversationLimit(
  identityId: string,
  conversationId: string,
  now = Date.now(),
): Promise<ConversationCharge> {
  const limit = await getPerConversationHour();
  const count = await incrementBucket(identityId, `conv:${conversationId}`, windowStart(now, HOUR_MS));
  if (count > limit) return { allowed: false, retryAfterSec: secondsUntilNextWindow(now, HOUR_MS), limit };
  return { allowed: true };
}
