import "server-only";

/**
 * Recomputing `city_benchmarks` from real scans.
 *
 * Runs nightly (`/api/scout/cron/benchmarks`) and on demand from Phase 7's admin
 * screen. Reads only scans that have actually been run, writes medians and —
 * crucially — the number of scans each median came from.
 */
import { Prisma, prisma, type Database, type DatabaseClient } from "@/lib/scout/db";
import {
  aggregateCityBenchmarks,
  type AggregateSummary,
  type BenchmarkFacility,
  type CityBenchmarkRow,
  type ScanBenchmarkInput,
} from "./aggregate";
import { canonicaliseCity, resolveScanCity } from "./city";

/** Scan statuses that represent a scan that actually ran. */
const COMPLETED_STATUSES = ["scanned", "report_sent"] as const;

/**
 * Advisory lock key for the recompute.
 *
 * The nightly cron and an admin clicking "recompute" can overlap. Both take
 * this lock, so the second waits rather than interleaving a delete from one run
 * with an insert from the other.
 */
const RECOMPUTE_LOCK_KEY = 0x5170_2c02; // "SITE SCOUT phase 02"

/**
 * Optional column that marks a row as hand-set and therefore not to be
 * overwritten. **It does not exist yet** — Phase 1 owns `src/db/schema.ts` and
 * this phase must not touch it, so the exact SQL to add it is in
 * `docs/PHASE-2-HANDOFF.md`.
 *
 * Everything here probes for the column and adapts. With it, manual overrides
 * survive the nightly recompute. Without it, `setCityBenchmarkOverride` still
 * writes, but the next recompute replaces the value — and says so out loud
 * rather than losing the edit quietly.
 */
export const MANUAL_OVERRIDE_COLUMN = "is_manual_override";

let manualOverrideColumnCache: boolean | null = null;

/** Exposed for tests, which create and drop the column to cover both paths. */
export function resetManualOverrideColumnCache(): void {
  manualOverrideColumnCache = null;
}

export async function hasManualOverrideColumn(database: Database = prisma): Promise<boolean> {
  if (manualOverrideColumnCache !== null) return manualOverrideColumnCache;

  const rows = await database.$queryRaw<Array<{ one: number }>>(Prisma.sql`
    SELECT 1 AS one FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'city_benchmarks'
      AND column_name = ${MANUAL_OVERRIDE_COLUMN}
    LIMIT 1
  `);
  manualOverrideColumnCache = rows.length > 0;
  return manualOverrideColumnCache;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Set key for a `(city, sportFormat)` pair.
 *
 * `JSON.stringify` rather than concatenating with a separator: a space would
 * let the all-formats row for "New Town" collide with a "Town"-format row for
 * "New", and one manual override would silently overwrite the other. An encoded
 * pair cannot collide and stays readable in a debugger.
 */
function benchmarkKey(city: string, sportFormat: string | null): string {
  return JSON.stringify([city, sportFormat ?? null]);
}

/** Load one `ScanBenchmarkInput` per completed scan. */
export async function loadScanInputs(database: Database = prisma): Promise<ScanBenchmarkInput[]> {
  const statuses = Prisma.join(
    COMPLETED_STATUSES.map((s) => Prisma.sql`${s}`),
    ", ",
  );

  const scanRows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      s.id::text                AS scan_id,
      st.city                   AS site_city,
      st.state                  AS site_state,
      s.address                 AS address,
      (
        SELECT SUM(sp.anchor_weight)
        FROM scan_places sp
        WHERE sp.scan_id = s.id AND sp.side = 'demand'
      )                         AS anchor_weight
    FROM scans s
    LEFT JOIN sites st ON st.id = s.site_id
    WHERE s.status IN (${statuses})
  `);

  const facilityRows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      sp.scan_id::text  AS scan_id,
      p.review_count    AS review_count,
      p.rating          AS rating,
      sp.categories     AS categories
    FROM scan_places sp
    JOIN places p ON p.id = sp.place_id
    JOIN scans s  ON s.id = sp.scan_id
    WHERE sp.side = 'competition' AND s.status IN (${statuses})
  `);

  const facilitiesByScan = new Map<string, BenchmarkFacility[]>();
  for (const row of facilityRows) {
    const scanId = String(row.scan_id);
    const list = facilitiesByScan.get(scanId) ?? [];
    list.push({
      reviewCount: toNumberOrNull(row.review_count),
      rating: toNumberOrNull(row.rating),
      categories: Array.isArray(row.categories) ? row.categories.map(String) : [],
    });
    facilitiesByScan.set(scanId, list);
  }

  return scanRows.map((row) => {
    const scanId = String(row.scan_id);
    return {
      scanId,
      city: resolveScanCity({
        siteCity: row.site_city as string | null,
        address: row.address as string | null,
      }),
      state: (row.site_state as string | null) ?? null,
      anchorWeight: toNumberOrNull(row.anchor_weight),
      facilities: facilitiesByScan.get(scanId) ?? [],
    };
  });
}

export interface RecomputeResult extends AggregateSummary {
  rowsWritten: number;
  overridesPreserved: number;
  /** False when `is_manual_override` is absent, so hand-set rows get replaced. */
  manualOverridesSupported: boolean;
  computedAt: Date;
}

/**
 * Rebuild every city benchmark from scratch.
 *
 * Delete-and-replace rather than upsert, for two reasons. The unique index on
 * `(city, sport_format)` is `NULLS DISTINCT`, so the all-formats row — which
 * carries `sport_format = NULL` — is not covered by it and `ON CONFLICT` would
 * never fire for the most important row in the table. And a format that no
 * longer appears in any scan should disappear rather than linger at its last
 * computed value.
 */
export async function recomputeCityBenchmarks(
  database: DatabaseClient = prisma,
): Promise<RecomputeResult> {
  const supportsOverrides = await hasManualOverrideColumn(database);
  const scans = await loadScanInputs(database);
  const { rows, summary } = aggregateCityBenchmarks(scans);
  const computedAt = new Date();

  const written = await database.$transaction(async (tx) => {
    // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`, and
    // Prisma cannot deserialize a `void` column out of a raw *query*.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${RECOMPUTE_LOCK_KEY})`);

    const keepOverrides = supportsOverrides
      ? Prisma.sql`WHERE NOT COALESCE(is_manual_override, FALSE)`
      : Prisma.empty;
    await tx.$executeRaw(Prisma.sql`DELETE FROM city_benchmarks ${keepOverrides}`);

    const overriddenKeys = new Set<string>();
    if (supportsOverrides) {
      const remaining = await tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`SELECT city, sport_format FROM city_benchmarks`,
      );
      for (const row of remaining) {
        overriddenKeys.add(benchmarkKey(String(row.city), row.sport_format as string | null));
      }
    }

    const writable = rows.filter(
      (row) => !overriddenKeys.has(benchmarkKey(row.city, row.sportFormat)),
    );

    for (const row of writable) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO city_benchmarks
          (city, state, sport_format, facilities_per_anchor, median_rating, median_review_count, sample_count, computed_at)
        VALUES (
          ${row.city}, ${row.state}, ${row.sportFormat},
          ${row.facilitiesPerAnchor}, ${row.medianRating}, ${row.medianReviewCount},
          ${row.sampleCount}, ${computedAt.toISOString()}
        )
      `);
    }

    return { count: writable.length, overrides: overriddenKeys.size };
  });

  return {
    ...summary,
    rowsWritten: written.count,
    overridesPreserved: written.overrides,
    manualOverridesSupported: supportsOverrides,
    computedAt,
  };
}

export interface BenchmarkOverride {
  city: string;
  sportFormat?: string | null;
  state?: string | null;
  facilitiesPerAnchor?: number | null;
  medianRating?: number | null;
  medianReviewCount?: number | null;
  /**
   * Required, and deliberately not defaulted.
   *
   * An override still has to declare how many observations stand behind it. A
   * hand-entered benchmark with an invented sample count would be worse than a
   * computed one, and `0` is the honest answer for a figure taken from
   * somewhere other than this system's scans.
   */
  sampleCount: number;
}

/**
 * Hand-set a benchmark, for a city where scans are too thin to be useful and
 * someone has a better figure from elsewhere.
 *
 * Returns whether the override will survive the nightly recompute. It will not,
 * until the `is_manual_override` column exists — callers should surface that
 * rather than assume the edit sticks.
 */
export async function setCityBenchmarkOverride(
  override: BenchmarkOverride,
  database: DatabaseClient = prisma,
): Promise<{ persisted: boolean; survivesRecompute: boolean }> {
  const city = canonicaliseCity(override.city);
  if (!city) throw new Error(`setCityBenchmarkOverride needs a city name, got "${override.city}".`);
  if (!Number.isInteger(override.sampleCount) || override.sampleCount < 0) {
    throw new Error(
      `setCityBenchmarkOverride needs a non-negative integer sampleCount, got ${override.sampleCount}.`,
    );
  }

  const supportsOverrides = await hasManualOverrideColumn(database);
  const sportFormat = override.sportFormat ?? null;

  await database.$transaction(async (tx) => {
    // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns `void`, and
    // Prisma cannot deserialize a `void` column out of a raw *query*.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${RECOMPUTE_LOCK_KEY})`);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM city_benchmarks
      WHERE city = ${city}
        AND sport_format IS NOT DISTINCT FROM ${sportFormat}
    `);

    const overrideColumn = supportsOverrides ? Prisma.sql`, is_manual_override` : Prisma.empty;
    const overrideValue = supportsOverrides ? Prisma.sql`, TRUE` : Prisma.empty;

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO city_benchmarks
        (city, state, sport_format, facilities_per_anchor, median_rating, median_review_count, sample_count, computed_at${overrideColumn})
      VALUES (
        ${city}, ${override.state ?? null}, ${sportFormat},
        ${override.facilitiesPerAnchor ?? null}, ${override.medianRating ?? null},
        ${override.medianReviewCount ?? null}, ${override.sampleCount}, NOW()${overrideValue}
      )
    `);
  });

  return { persisted: true, survivesRecompute: supportsOverrides };
}

export type { CityBenchmarkRow };
