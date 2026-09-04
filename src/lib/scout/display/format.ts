/**
 * Display formatting shared by every screen. Pure, and free of server imports
 * so a client component can use it.
 *
 * The interesting one is `atLeast`. Phase 1 flags a term whose tile returned
 * exactly the maximum result count, because that tile may have been truncated
 * and the count is therefore a floor. Every place a count is printed goes
 * through here, so "18" and "at least 18" are one decision made once rather
 * than eighteen decisions made separately and forgotten in one of them.
 */

/** A count, qualified as a floor where the search may have been truncated. */
export function atLeast(count: number, saturated: boolean): string {
  const n = formatCount(count);
  return saturated ? `at least ${n}` : n;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-IN");
}

/** Metres to the "0.6 km" / "820 m" form the mockups use. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatRadius(metres: number): string {
  const km = metres / 1000;
  return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
}

/** "16 Aug" — the dashboard card's date form. */
export function formatDayMonth(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** "16 Aug 2026" — the report header's date form. */
export function formatFullDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatRating(rating: number | null): string {
  return rating === null ? "—" : rating.toFixed(1);
}

export type VerdictTone = "green" | "blue" | "red";

/**
 * Verdict → badge tone, per the brief: green Proceed, blue Investigate, red
 * Avoid. Mapped here so the three screens that render a verdict cannot drift.
 */
export function verdictTone(verdict: "proceed" | "investigate" | "avoid"): VerdictTone {
  if (verdict === "proceed") return "green";
  if (verdict === "avoid") return "red";
  return "blue";
}

export function verdictLabel(verdict: "proceed" | "investigate" | "avoid"): string {
  if (verdict === "proceed") return "Proceed";
  if (verdict === "avoid") return "Avoid";
  return "Investigate";
}

export function confidenceLabel(level: "high" | "medium" | "low"): string {
  return `${level[0]?.toUpperCase()}${level.slice(1)} confidence`;
}

/** Short label for a desk-only score, for places too narrow for the full one. */
export const DESK_ONLY_SHORT = "Desk only";

const USD_TO_INR = 85;

/** Cost band in INR, converted from the USD estimate Google bills at. */
export function formatCostBand(minUsd: number, maxUsd: number): string {
  const minInr = minUsd * USD_TO_INR;
  const maxInr = maxUsd * USD_TO_INR;
  const f = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-IN")}`;
  if (Math.abs(maxInr - minInr) < 1) return f(minInr);
  return `${f(minInr)}–${f(maxInr)}`;
}

export function formatCallBand(minCalls: number, maxCalls: number): string {
  if (minCalls === maxCalls) return formatCount(minCalls);
  return `${formatCount(minCalls)}–${formatCount(maxCalls)}`;
}
