import { AgentHttpError } from "../errors";
import { isUuid } from "../schemas/read";

/**
 * Small pure helpers shared by the read tools. Nothing here touches the
 * database, so it is all unit-testable.
 */

/** A path id that is not a well-formed id can never match a row: answer 404, never ask the database. */
export function requireId(id: string | undefined, what: string): string {
  if (!id || !isUuid(id)) throw new AgentHttpError("not_found", `${what} not found.`);
  return id;
}

/** Prisma `contains` is a LIKE: escape \, % and _ so typed text matches literally. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, "\\$&");

export const toIso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const toNumber = (v: { toString(): string } | number | null | undefined): number | null =>
  v == null ? null : Number(v.toString());

export const digitsOnly = (s: string): string => s.replace(/\D/g, "");

/** Last four digits of a phone number, enough to tell two customers apart. */
export function phoneLast4(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = digitsOnly(phone);
  return d.length >= 4 ? d.slice(-4) : null;
}

/** Does this free text look like (part of) a phone number rather than a name? */
export function looksLikePhone(q: string): boolean {
  return /^[+\d][\d\s()+-]*$/.test(q.trim()) && digitsOnly(q).length >= 4;
}

/** Parse a stored JSON object of strings (custom fields); anything else is empty. */
export function parseStringMap(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v == null) continue;
      out[k] = typeof v === "string" ? v : String(v);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Cursor paging over an already-ordered list held in memory (small lists such
 * as the product catalogue). The cursor is the id of the last item returned.
 */
export function pageById<T extends { id: string }>(
  items: T[],
  limit: number,
  cursor: string | undefined,
): { items: T[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const at = items.findIndex((i) => i.id === cursor);
    if (at < 0) throw new AgentHttpError("invalid_input", "Unknown cursor. Start again without one.");
    start = at + 1;
  }
  const slice = items.slice(start, start + limit);
  const more = start + limit < items.length;
  return { items: slice, nextCursor: more && slice.length ? slice[slice.length - 1].id : null };
}

/** Offset cursors (an opaque non-negative integer) for lists that are assembled in memory. */
export function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  if (!/^\d{1,6}$/.test(cursor)) throw new AgentHttpError("invalid_input", "Unknown cursor. Start again without one.");
  return Number(cursor);
}

export function pageByOffset<T>(
  items: T[],
  limit: number,
  cursor: string | undefined,
): { items: T[]; nextCursor: string | null } {
  const start = parseOffsetCursor(cursor);
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null };
}

/** Day string (YYYY-MM-DD) to the start / end of that calendar day in India (IST). */
export const istDayStart = (day: string): Date => new Date(`${day}T00:00:00+05:30`);
export const istDayEnd = (day: string): Date => new Date(`${day}T23:59:59.999+05:30`);
