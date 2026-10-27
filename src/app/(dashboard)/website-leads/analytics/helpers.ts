// Small formatters, labels and colours shared by the Analytics tab's sections.
import type { SourceGroup } from "@/lib/website-analytics/sources";
import type { RangePreset } from "@/lib/website-analytics/types";

/** The date range picked in the Analytics tab; from/to are only used for "custom". */
export type RangeChoice = { preset: RangePreset; from: string; to: string };

/** The range part of the analytics query string. */
export function rangeQuery(r: RangeChoice): string {
  return r.preset === "custom" ? `&range=custom&from=${r.from}&to=${r.to}` : `&range=${r.preset}`;
}

// One colour per source group, used by every bar so "AI assistants" looks the
// same in the channel bars and in Leads by source.
export const GROUP_COLORS: Record<SourceGroup, string> = {
  "AI assistants": "#8b5cf6",
  Search: "#0ea5e9",
  "Paid ads": "#f59e0b",
  Social: "#ec4899",
  Email: "#14b8a6",
  "Other websites": "#6366f1",
  Direct: "#566268",
  Unknown: "#94a3b8",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-12" → "12 Oct" (or "12 Oct 2026"). No Date object, so no time zone surprises. */
export function fmtDay(ymd: string, withYear = false): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

export const fmtNum = (n: number) => n.toLocaleString("en-IN");

/** Seconds → "8s", "1m 12s", "1h 5m". */
export function fmtSecs(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** A fraction as a percentage with one decimal: 0.034 → "3.4%". */
export const fmtRate = (f: number | null) => (f == null ? "—" : `${(f * 100).toFixed(1)}%`);

/** A fraction as a whole-number share: 0.4 → "40%". */
export function fmtShare(f: number): string {
  if (f > 0 && f < 0.01) return "<1%";
  return `${Math.round(f * 100)}%`;
}

/** Change against the previous period as a fraction (0.12 = up 12%); null when there is nothing to compare with. */
export function pctChange(value: number | null, previous: number | null): number | null {
  if (value == null || previous == null || previous <= 0) return null;
  return (value - previous) / previous;
}

/** When the data was fetched, as a clock time on the Asia/Kolkata clock ("3:45 pm"). */
export function fmtUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** Google's device names in plain words. */
export function deviceLabel(raw: string): string {
  switch (raw.toLowerCase()) {
    case "mobile":
      return "Phone";
    case "desktop":
      return "Computer";
    case "tablet":
      return "Tablet";
    case "smart tv":
      return "TV";
    case "":
    case "(not set)":
      return "Unknown";
    default:
      return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
}

/** Google writes "(not set)" for an unknown city. */
export function nameOrUnknown(raw: string): string {
  const v = raw.trim();
  return !v || v.toLowerCase() === "(not set)" ? "Unknown" : v;
}

/** A full page address → "/path?query" for display. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const out = `${u.pathname}${u.search}`;
    return out === "/" ? u.host : out;
  } catch {
    return url;
  }
}
