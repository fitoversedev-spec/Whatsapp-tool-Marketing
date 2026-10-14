// The rule for "send this later": at least 2 minutes from now (to avoid racing
// the immediate-launch path) and at most 90 days out. One copy, used by the
// human routes and the AI agent's schedule_broadcast.

export const SCHEDULE_MIN_MS = 2 * 60 * 1000;
export const SCHEDULE_MAX_MS = 90 * 24 * 60 * 60 * 1000;

/** The human-readable problem with this time, or null when it is acceptable. */
export function scheduleWindowError(candidate: Date, now: number = Date.now()): string | null {
  if (candidate < new Date(now + SCHEDULE_MIN_MS)) return "Scheduled time must be at least 2 minutes in the future";
  if (candidate > new Date(now + SCHEDULE_MAX_MS)) return "Scheduled time must be within 90 days";
  return null;
}
