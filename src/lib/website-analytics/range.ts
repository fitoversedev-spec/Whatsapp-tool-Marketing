// The date range an analytics view is asked for: a preset or a custom pair of
// days, always on the Asia/Kolkata calendar (the team works in IST and Vercel
// runs in UTC), plus the previous period of the same length to compare with.
import { RANGE_PRESETS, type RangePreset, type ResolvedRange } from "./types";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
export const MAX_MONTHS_BACK = 18;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const toMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today's date on the IST calendar. */
export function todayIST(now: Date = new Date()): string {
  return fromMs(now.getTime() + IST_OFFSET_MS);
}

export function addDays(ymd: string, n: number): string {
  return fromMs(toMs(ymd) + n * DAY_MS);
}

export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fromMs(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
}

/** Days from `from` to `to`, both included. */
export function dayCount(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
}

/** Every date from `from` to `to`. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Is this a real YYYY-MM-DD calendar date? */
export function isYmd(v: string | null | undefined): v is string {
  return !!v && YMD.test(v) && !Number.isNaN(toMs(v)) && fromMs(toMs(v)) === v;
}

/** The instant an IST day starts / ends, for querying timestamps stored in UTC. */
export const istDayStart = (ymd: string) => new Date(toMs(ymd) - IST_OFFSET_MS);
export const istDayEnd = (ymd: string) => new Date(toMs(ymd) + DAY_MS - 1 - IST_OFFSET_MS);

/** The IST calendar date an instant falls on. */
export const istDateOf = (at: Date) => fromMs(at.getTime() + IST_OFFSET_MS);

const withPrevious = (preset: RangePreset, from: string, to: string): ResolvedRange => {
  const days = dayCount(from, to);
  const prevTo = addDays(from, -1);
  return { preset, from, to, prevFrom: addDays(prevTo, -(days - 1)), prevTo, days };
};

/**
 * Resolve ?range= (default 30d) with ?from= / ?to= for "custom". 7d and 30d end
 * today and count today; this_month runs from the 1st to today; last_month is the
 * whole previous month. Custom ranges end no later than today and start no
 * earlier than 18 months ago.
 */
export function resolveRange(
  input: { range?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date(),
): { ok: true; range: ResolvedRange } | { ok: false; error: string } {
  const today = todayIST(now);
  const raw = (input.range ?? "").trim();
  const preset = (raw || (input.from && input.to ? "custom" : "30d")) as RangePreset;
  if (!(RANGE_PRESETS as readonly string[]).includes(preset)) return { ok: false, error: "Unknown date range." };

  switch (preset) {
    case "7d":
      return { ok: true, range: withPrevious(preset, addDays(today, -6), today) };
    case "30d":
      return { ok: true, range: withPrevious(preset, addDays(today, -29), today) };
    case "this_month":
      return { ok: true, range: withPrevious(preset, `${today.slice(0, 7)}-01`, today) };
    case "last_month": {
      const thisFirst = `${today.slice(0, 7)}-01`;
      const lastTo = addDays(thisFirst, -1);
      return { ok: true, range: withPrevious(preset, `${lastTo.slice(0, 7)}-01`, lastTo) };
    }
    default: {
      const { from, to } = input;
      if (!isYmd(from) || !isYmd(to)) return { ok: false, error: "Pick a start and an end date." };
      if (from > to) return { ok: false, error: "The start date must not be after the end date." };
      if (to > today) return { ok: false, error: "The end date can't be in the future." };
      if (from < addMonths(today, -MAX_MONTHS_BACK)) {
        return { ok: false, error: `The start date can't be more than ${MAX_MONTHS_BACK} months ago.` };
      }
      return { ok: true, range: withPrevious("custom", from, to) };
    }
  }
}
