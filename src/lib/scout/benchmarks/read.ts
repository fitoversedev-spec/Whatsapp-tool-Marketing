import "server-only";

/**
 * Reading city benchmarks, for the score's saturation component and the report.
 *
 * Every read carries `sampleCount` and the caveat sentence that goes with it.
 * The two travel together on purpose: a benchmark handed to a renderer without
 * its sample count is a figure that will get printed as if it were a city
 * statistic.
 */
import { Prisma, prisma, type Database } from "@/lib/scout/db";
import { benchmarkSampleCaveat, BENCHMARK_INDICATIVE_BELOW } from "@/lib/scout/census/disclosure";
import { canonicaliseCity } from "./city";

export interface CityBenchmark {
  city: string;
  state: string | null;
  sportFormat: string | null;
  /** Facilities per unit of weighted demand anchor. */
  facilitiesPerAnchor: number | null;
  /**
   * The same figure inverted — "one facility per N anchors" — which is how the
   * report phrases it. `null` when `facilitiesPerAnchor` is null or zero.
   */
  anchorsPerFacility: number | null;
  medianRating: number | null;
  medianReviewCount: number | null;
  /** How many scans produced this row. Always shown, never inferred. */
  sampleCount: number;
  /** Below `BENCHMARK_INDICATIVE_BELOW` scans this is a guess, not a statistic. */
  isIndicativeOnly: boolean;
  /** Ready-made wording for the report, matched to `sampleCount`. */
  sampleCaveat: string | null;
  computedAt: Date | null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBenchmark(row: Record<string, unknown>): CityBenchmark {
  const facilitiesPerAnchor = toNumberOrNull(row.facilities_per_anchor);
  const sampleCount = toNumberOrNull(row.sample_count) ?? 0;

  return {
    city: String(row.city),
    state: (row.state as string | null) ?? null,
    sportFormat: (row.sport_format as string | null) ?? null,
    facilitiesPerAnchor,
    anchorsPerFacility:
      facilitiesPerAnchor && facilitiesPerAnchor > 0
        ? Math.round((1 / facilitiesPerAnchor) * 100) / 100
        : null,
    medianRating: toNumberOrNull(row.median_rating),
    medianReviewCount: toNumberOrNull(row.median_review_count),
    sampleCount,
    isIndicativeOnly: sampleCount < BENCHMARK_INDICATIVE_BELOW,
    sampleCaveat: benchmarkSampleCaveat(sampleCount),
    computedAt: row.computed_at ? new Date(String(row.computed_at)) : null,
  };
}

/**
 * The benchmark for a city, optionally for one sport format.
 *
 * Returns `null` when no benchmark exists — which is the normal state for a
 * city nobody has scanned yet. Phase 3 must score saturation without a
 * comparison rather than substituting another city's median.
 */
export async function getCityBenchmark(
  city: string,
  sportFormat: string | null = null,
  database: Database = prisma,
): Promise<CityBenchmark | null> {
  const canonical = canonicaliseCity(city);
  if (!canonical) return null;

  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT city, state, sport_format, facilities_per_anchor, median_rating,
           median_review_count, sample_count, computed_at
    FROM city_benchmarks
    WHERE city = ${canonical}
      AND sport_format IS NOT DISTINCT FROM ${sportFormat}
    LIMIT 1
  `);

  const row = rows[0];
  return row ? toBenchmark(row) : null;
}

/** Every benchmark row, newest computation first. Phase 7's admin table. */
export async function listCityBenchmarks(database: Database = prisma): Promise<CityBenchmark[]> {
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT city, state, sport_format, facilities_per_anchor, median_rating,
           median_review_count, sample_count, computed_at
    FROM city_benchmarks
    ORDER BY city ASC, sport_format ASC NULLS FIRST
  `);
  return rows.map(toBenchmark);
}
