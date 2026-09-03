/**
 * Display formatting shared by the phone screens.
 *
 * Pure, and deliberately small. Nothing here decides anything — the counts,
 * saturation flags and score all arrive already decided by Phases 1 and 3.
 * This only chooses how they read on a 390px screen.
 */

/** `620` → `"0.6 km"`, `85` → `"85 m"`. The mockup prints one decimal. */
export function formatDistance(metres: number | null | undefined): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return "—";
  if (metres < 1_000) return `${Math.round(metres)} m`;
  return `${(metres / 1_000).toFixed(1)} km`;
}

/**
 * A count, qualified when the scan may have been truncated.
 *
 * Phase 1's rule, restated at the point of rendering: if any tile came back
 * with exactly the maximum result count for a term, that count is a **floor**.
 * "18 facilities" is a claim we cannot support; "at least 18 facilities" is.
 */
export function formatCount(count: number, exact: boolean): string {
  return exact ? String(count) : `at least ${count}`;
}

/** `4062` → `"4,062"`. Indian screens still read grouped thousands here. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN");
}

/** `4.34` → `"4.3"`, `null` → `"—"`. Ratings are never coerced from null to 0. */
export function formatRating(rating: number | null | undefined): string {
  if (rating === null || rating === undefined || !Number.isFinite(rating)) return "—";
  return rating.toFixed(1);
}

/** `16 Aug 2026`, matching the mockup's saved-site rows. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** "4 minutes ago", "3 days ago". Used by the offline banner. */
export function formatAgo(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "an unknown time ago";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "an unknown time ago";

  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** `2000` → `"2 km"`, matching the radius grid and the header subtitle. */
export function formatRadius(metres: number): string {
  return metres % 1_000 === 0 ? `${metres / 1_000} km` : `${(metres / 1_000).toFixed(1)} km`;
}

/** Minute-of-day → `"06:00"`. Phase 1's operating window may exceed 1440. */
export function formatMinuteOfDay(minute: number | null | undefined): string | null {
  if (minute === null || minute === undefined || !Number.isFinite(minute)) return null;
  const wrapped = ((Math.round(minute) % 1_440) + 1_440) % 1_440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Verdict → the Badge tone the design system already ships. */
export function verdictTone(verdict: string): "green" | "blue" | "red" | "neutral" {
  if (verdict === "proceed") return "green";
  if (verdict === "investigate") return "blue";
  if (verdict === "avoid") return "red";
  return "neutral";
}

/** Sentence-case verdict for a badge ("Proceed", "Investigate", "Avoid"). */
export function verdictLabel(verdict: string): string {
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}
