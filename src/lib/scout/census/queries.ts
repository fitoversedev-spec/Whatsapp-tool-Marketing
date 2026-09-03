import "server-only";

/**
 * The real spatial queries.
 *
 * `population_grid` and `census_district` are **empty in this build** and these
 * functions are not called on the default path — `getCatchmentProfile` returns
 * before reaching them. They are written and integration-tested against seeded
 * fixtures anyway, because the whole point of the scaffolding is that switching
 * population on is an ingest plus a config change, not new code.
 *
 * `tests/integration/catchmentQuery.test.ts` seeds fixture cells and asserts
 * these produce the right sums. Delete neither.
 */
import { Prisma, prisma, type Database } from "@/lib/scout/db";
import type { CensusDistrictRatios, PopulationGridGroup, PopulationGridSum } from "./profile";
import type { AgeBand } from "./profile";

/**
 * Beyond this, the nearest district centroid is not describing this catchment.
 *
 * Indian districts average a few thousand km²; a centroid 250 km away means the
 * catchment sits outside whatever was ingested. Borrowing ratios from it would
 * be applying Chennai's age structure to a plot in Punjab.
 */
export const MAX_DISTRICT_CENTROID_DISTANCE_M = 250_000;

export interface PopulationSourceFilter {
  /** e.g. `worldpop-ind-constrained`. Pin this once more than one is loaded. */
  source?: string;
  vintageYear?: number;
}

/**
 * The catchment centre as a `geography` literal.
 *
 * The `::double precision` casts are not decoration — node-postgres sends bound
 * parameters as `unknown`, and an untyped argument lets Postgres resolve a
 * PostGIS function to its `geometry` overload and cast the `geography` column
 * across, quietly abandoning the index.
 */
function point(lat: number, lng: number) {
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography`;
}

/**
 * "Within `radiusM` metres of (`lat`, `lng`)", written out rather than as
 * `ST_DWithin`.
 *
 * This is exactly the plan `ST_DWithin` produces — a GIST index scan on the
 * bounding-box overlap operator, then an exact geodesic distance filter — and
 * `EXPLAIN` confirms `Index Scan using population_grid_location_gix`. Both
 * halves default to `use_spheroid = true`, so the result is identical to
 * `ST_DWithin(location, centre, radiusM)`.
 *
 * ## Why not just call ST_DWithin
 *
 * On Neon (Postgres 18.4, PostGIS 3.6.0), running
 * `DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION postgis`
 * leaves `ST_DWithin` against an **indexed** `geography` column failing outright
 * with `no spatial operator found for 'st_dwithin': opfamily <n> type <n>`,
 * raised from `postgis_index_supportfn`. It is reproducible, survives new
 * connections, and clears only when the compute restarts. The GIST index is
 * present and correct — `gist_geography_ops`, carrying `&&` at strategy 3 — so
 * the planner's index support function is resolving stale type OIDs left by the
 * extension being recreated.
 *
 * The test harness re-runs that exact sequence before every suite
 * (`tests/helpers/globalSetup.ts`), and migration `0000_init.sql` runs
 * `CREATE EXTENSION postgis` on every freshly provisioned database — including
 * production. Writing the predicate out is immune to it, costs nothing, and
 * removes a dependency on a planner hook that has already been observed to
 * break. See `docs/PHASE-2-HANDOFF.md`.
 */
function withinRadius(lat: number, lng: number, radiusM: number) {
  const centre = point(lat, lng);
  return Prisma.sql`location && _ST_Expand(${centre}, ${radiusM}::double precision)
      AND ST_Distance(location, ${centre}) <= ${radiusM}::double precision`;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

/**
 * Sum every population-grid cell whose centroid falls within `radiusM`.
 *
 * The radius test is geodesic and in metres, and rides the GIST index on
 * `location`, so this stays an index scan rather than a table scan — which is
 * what makes it viable once the table holds tens of millions of cells. See
 * `withinRadius` for why the predicate is spelled out rather than delegated to
 * `ST_DWithin`.
 *
 * Results are grouped by `(source, vintage_year, cell_size_m)` rather than
 * summed flat. Two vintages of the same product overlapping one radius would
 * silently double the catchment population, and a grouped result makes that
 * visible to the caller instead of invisible in a report.
 */
export async function sumPopulationWithin(
  lat: number,
  lng: number,
  radiusM: number,
  filter: PopulationSourceFilter = {},
  database: Database = prisma,
): Promise<PopulationGridSum> {
  const sourceFilter = filter.source
    ? Prisma.sql` AND source = ${filter.source}`
    : Prisma.empty;
  const vintageFilter =
    typeof filter.vintageYear === "number"
      ? Prisma.sql` AND vintage_year = ${filter.vintageYear}`
      : Prisma.empty;

  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      source,
      vintage_year,
      cell_size_m,
      COUNT(*)::int AS cells,
      COALESCE(SUM(population), 0)::double precision AS population
    FROM population_grid
    WHERE ${withinRadius(lat, lng, radiusM)}${sourceFilter}${vintageFilter}
    GROUP BY source, vintage_year, cell_size_m
    ORDER BY source, vintage_year, cell_size_m
  `);

  const groups: PopulationGridGroup[] = rows.map((row) => ({
    source: String(row.source),
    vintageYear: toNumber(row.vintage_year),
    cellSizeM: toNumber(row.cell_size_m),
    cells: toNumber(row.cells),
    population: toNumber(row.population),
  }));

  return {
    total: groups.reduce((sum, g) => sum + g.population, 0),
    cellCount: groups.reduce((sum, g) => sum + g.cells, 0),
    groups,
  };
}

/**
 * The census district whose centroid is nearest the catchment centre.
 *
 * `<->` on `geography` is a KNN operator backed by the GIST index, so this is a
 * short index walk rather than a distance calculation over every district.
 * Returns `null` when nothing is loaded, or when the nearest centroid is far
 * enough away that its ratios would not describe this place.
 */
export async function findNearestCensusDistrict(
  lat: number,
  lng: number,
  database: Database = prisma,
): Promise<CensusDistrictRatios | null> {
  const centre = point(lat, lng);

  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      census_code,
      district_name,
      state_name,
      age_ratios,
      household_size_avg,
      urban_share,
      source,
      vintage_year,
      ST_Distance(centroid, ${centre}) AS distance_m
    FROM census_district
    WHERE centroid IS NOT NULL
    ORDER BY centroid <-> ${centre}
    LIMIT 1
  `);

  const row = rows[0];
  if (!row) return null;

  const distanceM = toNumber(row.distance_m);
  if (!Number.isFinite(distanceM) || distanceM > MAX_DISTRICT_CENTROID_DISTANCE_M) return null;

  const householdSizeAvg =
    row.household_size_avg === null ? null : toNumber(row.household_size_avg);
  const urbanShare = row.urban_share === null ? null : toNumber(row.urban_share);

  return {
    censusCode: String(row.census_code),
    districtName: String(row.district_name),
    stateName: String(row.state_name),
    ageRatios: (row.age_ratios as Partial<Record<AgeBand, number>> | null) ?? null,
    householdSizeAvg,
    urbanShare,
    source: String(row.source),
    vintageYear: toNumber(row.vintage_year),
    distanceM,
  };
}

/** Row counts, for the handoff's "is anything actually loaded?" check. */
export async function populationDataStatus(
  database: Database = prisma,
): Promise<{ gridCells: number; censusDistricts: number }> {
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM population_grid) AS grid_cells,
      (SELECT COUNT(*)::int FROM census_district) AS census_districts
  `);
  const row = rows[0];
  return {
    gridCells: toNumber(row?.grid_cells),
    censusDistricts: toNumber(row?.census_districts),
  };
}
