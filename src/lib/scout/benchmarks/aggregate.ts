/**
 * Turning eligible scans into city benchmark rows. Pure — no database.
 *
 * `city_benchmarks` is **not** deferred. The score's competitive-saturation
 * component compares a site against its city, and without population the
 * denominator is the weighted demand anchor (see `IMPLEMENTATION-PLAN.md` §4):
 *
 *   "6 turfs serving 38 weighted demand anchors — one per 6.3, against a
 *    Bengaluru median of one per 4.1."
 *
 * The sample count is part of the claim, not a footnote. A median from three
 * scans is a guess and a median from forty is data, and the difference has to be
 * visible on the record rather than implied by its existence.
 */

/** A format row needs at least this many scans; below that it is noise, not a median. */
export const MIN_SAMPLE_FOR_FORMAT_ROW = 2;

export interface BenchmarkFacility {
  /** Google review count for this competitor. `null` when Google reported none. */
  reviewCount: number | null;
  rating: number | null;
  /** `scan_places.categories` — a venue routinely belongs to several. */
  categories: string[];
}

export interface ScanBenchmarkInput {
  scanId: string;
  city: string | null;
  state: string | null;
  /**
   * Sum of `scan_places.anchor_weight` over demand-side places.
   *
   * `null` until Phase 3 computes anchor weights. A scan without one cannot
   * contribute, because facilities-per-anchor is undefined without a
   * denominator — see `recomputeCityBenchmarks`.
   */
  anchorWeight: number | null;
  facilities: BenchmarkFacility[];
}

export interface CityBenchmarkRow {
  city: string;
  state: string | null;
  /** `null` means "all formats combined". */
  sportFormat: string | null;
  facilitiesPerAnchor: number | null;
  medianRating: number | null;
  medianReviewCount: number | null;
  /** Scans this row was derived from. Printed in reports; never inferred. */
  sampleCount: number;
}

export interface AggregateSummary {
  scansConsidered: number;
  scansEligible: number;
  skippedNoCity: number;
  skippedNoAnchorWeight: number;
  citiesBenchmarked: number;
  formatRowsWritten: number;
}

export interface AggregateResult {
  rows: CityBenchmarkRow[];
  summary: AggregateSummary;
}

/**
 * True median — the mean of the two middle values on an even count, not the
 * lower of them. Returns `null` for an empty set rather than 0, because "no
 * observations" and "an observed zero" are different claims.
 */
export function median(values: number[]): number | null {
  const usable = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Round to `places` decimals, preserving `null`. */
function round(value: number | null, places: number): number | null {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function buildRow(
  city: string,
  state: string | null,
  sportFormat: string | null,
  scans: Array<{ facilityCount: number; anchorWeight: number; facilities: BenchmarkFacility[] }>,
): CityBenchmarkRow {
  const perAnchor = scans
    .filter((s) => s.anchorWeight > 0)
    .map((s) => s.facilityCount / s.anchorWeight);

  const facilities = scans.flatMap((s) => s.facilities);
  const reviewCounts = facilities
    .map((f) => f.reviewCount)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  const ratings = facilities
    .map((f) => f.rating)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);

  return {
    city,
    state,
    sportFormat,
    facilitiesPerAnchor: round(median(perAnchor), 4),
    medianRating: round(median(ratings), 2),
    medianReviewCount: round(median(reviewCounts), 1),
    sampleCount: scans.length,
  };
}

/**
 * Build one all-formats row per city, plus a row per sport format with enough
 * scans behind it to mean anything.
 *
 * A scan is eligible only when it has **both** a resolved city and a positive
 * demand-anchor weight. Requiring both is what keeps `sampleCount` honest: every
 * metric on a row is derived from exactly the scans that row counts, so the
 * number a report prints applies to every figure beside it.
 */
export function aggregateCityBenchmarks(scans: ScanBenchmarkInput[]): AggregateResult {
  let skippedNoCity = 0;
  let skippedNoAnchorWeight = 0;

  const eligible = scans.filter((scan) => {
    if (!scan.city) {
      skippedNoCity += 1;
      return false;
    }
    if (
      typeof scan.anchorWeight !== "number" ||
      !Number.isFinite(scan.anchorWeight) ||
      scan.anchorWeight <= 0
    ) {
      skippedNoAnchorWeight += 1;
      return false;
    }
    return true;
  });

  const byCity = new Map<string, ScanBenchmarkInput[]>();
  for (const scan of eligible) {
    const list = byCity.get(scan.city!) ?? [];
    list.push(scan);
    byCity.set(scan.city!, list);
  }

  const rows: CityBenchmarkRow[] = [];
  let formatRowsWritten = 0;

  for (const [city, cityScans] of [...byCity.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // The most frequently reported state wins; scans in one city should agree,
    // and where they do not, the majority is the least surprising answer.
    const stateCounts = new Map<string, number>();
    for (const scan of cityScans) {
      if (scan.state) stateCounts.set(scan.state, (stateCounts.get(scan.state) ?? 0) + 1);
    }
    const state = [...stateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    rows.push(
      buildRow(
        city,
        state,
        null,
        cityScans.map((s) => ({
          facilityCount: s.facilities.length,
          anchorWeight: s.anchorWeight!,
          facilities: s.facilities,
        })),
      ),
    );

    const formats = new Set(cityScans.flatMap((s) => s.facilities.flatMap((f) => f.categories)));
    for (const format of [...formats].sort()) {
      const scansWithFormat = cityScans
        .map((s) => ({
          anchorWeight: s.anchorWeight!,
          facilities: s.facilities.filter((f) => f.categories.includes(format)),
        }))
        .filter((s) => s.facilities.length > 0)
        .map((s) => ({ ...s, facilityCount: s.facilities.length }));

      if (scansWithFormat.length < MIN_SAMPLE_FOR_FORMAT_ROW) continue;

      rows.push(buildRow(city, state, format, scansWithFormat));
      formatRowsWritten += 1;
    }
  }

  return {
    rows,
    summary: {
      scansConsidered: scans.length,
      scansEligible: eligible.length,
      skippedNoCity,
      skippedNoAnchorWeight,
      citiesBenchmarked: byCity.size,
      formatRowsWritten,
    },
  };
}
