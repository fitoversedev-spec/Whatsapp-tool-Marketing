/**
 * The saturating curve, and the small numeric helpers everything else shares.
 *
 * Every component maps its raw input through `P × (1 − e^(−x/x₀))` rather than
 * scaling linearly to a cap. Two reasons, and the second is the one that
 * matters:
 *
 * 1. No single input can dominate. Doubling an already-large count moves the
 *    score a little; doubling a small one moves it a lot, which is where the
 *    real information is.
 * 2. **It never reaches its maximum.** A component that can hit 30/30 invites
 *    "what would make this perfect?", and there is no honest answer — the scan
 *    counts Google listings, not everything that exists. An asymptote is the
 *    arithmetic expression of "we cannot see everything".
 *
 * `x₀` is the input value at which ~63 % of the points are awarded. It lives in
 * the score model, tunable per city.
 */

/** `P × (1 − e^(−x/x₀))`. Clamped at zero for negative or non-finite input. */
export function saturating(x: number, x0: number, maxPoints: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (!Number.isFinite(x0) || x0 <= 0) return 0;
  return maxPoints * (1 - Math.exp(-x / x0));
}

/** Distance decay `e^(−d/D)`. 1 at the centre, ~0.37 at `D`. */
export function distanceDecay(distanceM: number, decayDistanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 1;
  if (!Number.isFinite(decayDistanceM) || decayDistanceM <= 0) return 0;
  return Math.exp(-distanceM / decayDistanceM);
}

/**
 * Round to `dp` decimal places, half away from zero.
 *
 * Applied to every published number so a score is byte-stable across runs and
 * a golden file diff shows a weight change rather than floating-point noise.
 */
export function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Herfindahl index of a set of shares, normalised so 0 is a perfectly even
 * split and 1 is one holder taking everything.
 *
 * A single holder returns 1: one venue owning every review in the catchment is
 * maximal concentration, and treating `n = 1` as "no concentration" would hide
 * the clearest single-operator market there is.
 */
export function normalisedConcentration(values: readonly number[]): number {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  const n = positive.length;
  if (n === 0) return 0;
  if (n === 1) return 1;
  const total = positive.reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  const hhi = positive.reduce((s, v) => s + (v / total) ** 2, 0);
  return clamp((hhi - 1 / n) / (1 - 1 / n), 0, 1);
}

/** Median of a list. `null` when the list is empty. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * `1,234` — counts with thousands separators.
 *
 * Grouped by hand rather than through `toLocaleString`, because Node builds
 * differ in which locale data they carry and a score's printed text must not
 * change with the runtime it was rendered on.
 */
export function formatCount(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A number for prose: at most one decimal place, no trailing `.0`. */
export function formatNumber(value: number, dp = 1): string {
  const rounded = round(value, dp);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(dp);
}

/**
 * An anchor weight, always to two decimal places.
 *
 * `1` and `0.80` in the same sentence read as different kinds of number;
 * `1.00` and `0.80` read as a table. Weights are compared to each other far
 * more often than they are read alone.
 */
export function formatWeight(value: number): string {
  return round(value, 2).toFixed(2);
}

/** Metres as the report says them: `1.8 km` above a kilometre, `640 m` below. */
export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${formatNumber(metres / 1000, 1)} km` : `${Math.round(metres)} m`;
}

/** `x/y` with both sides rounded for print. */
export function formatPoints(points: number, available: number): string {
  return `${formatNumber(points, 1)}/${formatNumber(available, 1)}`;
}

/** Pluralise on the count. `1 facility`, `6 facilities`. */
export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}
