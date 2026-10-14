/** Pure helpers for the get_events feed and the list cursors. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const EVENT_TYPES = ["message", "lead"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type Cursor = { t: string; id: string };

export function encodeCursor(c: { t: Date | string; id: string }): string {
  const t = c.t instanceof Date ? c.t.toISOString() : c.t;
  return Buffer.from(JSON.stringify({ t, id: c.id }), "utf8").toString("base64url");
}

/** null when the cursor is not one we issued (the caller answers 400). */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof v.t !== "string" || typeof v.id !== "string" || !v.id || v.id.length > 64) return null;
    if (Number.isNaN(Date.parse(v.t))) return null;
    return { t: new Date(v.t).toISOString(), id: v.id };
  } catch {
    return null;
  }
}

/** "message,lead" -> ["message","lead"]; null when anything is unknown or the list is empty. */
export function parseEventTypes(raw: string | null | undefined): EventType[] | null {
  const parts = (raw ?? "message,lead")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length || parts.some((p) => !(EVENT_TYPES as readonly string[]).includes(p))) return null;
  return [...new Set(parts)] as EventType[];
}

/** get_events looks back at most 7 days; reports the earliest allowed moment when `from` is older. */
export function checkEventStart(from: Date, now: number): { ok: true } | { ok: false; earliest: string } {
  const earliest = now - MAX_EVENT_AGE_MS;
  return from.getTime() >= earliest ? { ok: true } : { ok: false, earliest: new Date(earliest).toISOString() };
}

export type FeedEvent = { type: EventType; id: string; at: string };

/** Merge per-source lists into one (time, id)-ordered page of at most `limit`. */
export function mergeEvents<T extends FeedEvent>(lists: readonly (readonly T[])[], limit: number) {
  const all = lists
    .flat()
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const events = all.slice(0, limit);
  const last = events[events.length - 1];
  return {
    events,
    hasMore: all.length > limit,
    nextCursor: last ? encodeCursor({ t: last.at, id: last.id }) : null,
  };
}
