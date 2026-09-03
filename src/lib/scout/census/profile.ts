/**
 * Assembling a `CatchmentProfile` from raw source rows. Pure — no database, no
 * environment — so both branches are unit-testable without a fixture load.
 *
 * The rule this file enforces: **every input must be present and sane, or the
 * whole profile is unavailable.** There is no partial profile. A total with no
 * age split would be reported as a population figure with an invented age
 * breakdown, which is the failure mode the union exists to prevent.
 */
import type {
  CatchmentAffluence,
  CatchmentAgeSplit,
  CatchmentProfile,
  ProvenanceEntry,
} from "./types";

/** Age bands, in the order the report prints them. */
export const AGE_BANDS = ["under15", "age15_40", "age40_60", "over60"] as const;

export type AgeBand = (typeof AGE_BANDS)[number];

/** Ratios must sum to 1 within this tolerance or the district row is rejected. */
export const AGE_RATIO_TOLERANCE = 0.02;

/** Household sizes outside this range indicate a bad row, not an unusual district. */
export const MIN_HOUSEHOLD_SIZE = 1;
export const MAX_HOUSEHOLD_SIZE = 15;

/** `resolutionM` for a source that is not a grid. See `ProvenanceEntry`. */
export const NOT_GRIDDED = 0;

/** One `(source, vintage)` group of population-grid cells inside the catchment. */
export interface PopulationGridGroup {
  source: string;
  vintageYear: number;
  cellSizeM: number;
  cells: number;
  population: number;
}

export interface PopulationGridSum {
  total: number;
  cellCount: number;
  /** One entry per distinct `(source, vintage_year, cell_size_m)` matched. */
  groups: PopulationGridGroup[];
}

export interface CensusDistrictRatios {
  censusCode: string;
  districtName: string;
  stateName: string;
  ageRatios: Partial<Record<AgeBand, number>> | null;
  householdSizeAvg: number | null;
  urbanShare: number | null;
  source: string;
  vintageYear: number;
  /** Metres from the catchment centre to the district centroid. */
  distanceM: number;
}

export interface AssembleInputs {
  areaKm2: number;
  grid: PopulationGridSum | null;
  district: CensusDistrictRatios | null;
  affluence: CatchmentAffluence | null;
}

/**
 * Normalise age ratios, or reject the row.
 *
 * Ratios that do not sum to 1 within tolerance are a broken ingest, not a
 * roundable inconvenience — a set summing to 0.6 would silently lose 40% of the
 * catchment. Within tolerance they are rescaled so the four head counts add up
 * to the total exactly.
 */
export function normaliseAgeRatios(
  ratios: Partial<Record<AgeBand, number>> | null | undefined,
): Record<AgeBand, number> | null {
  if (!ratios) return null;

  const values: Record<AgeBand, number> = { under15: 0, age15_40: 0, age40_60: 0, over60: 0 };
  let sum = 0;
  for (const band of AGE_BANDS) {
    const value = ratios[band];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    values[band] = value;
    sum += value;
  }

  if (sum <= 0) return null;
  if (Math.abs(sum - 1) > AGE_RATIO_TOLERANCE) return null;

  for (const band of AGE_BANDS) values[band] = values[band] / sum;
  return values;
}

function unavailable(areaKm2: number): CatchmentProfile {
  return { available: false, reason: "not_ingested", areaKm2 };
}

/**
 * Build the profile, or report it unavailable.
 *
 * Reached only when population has been switched on and the tables have rows;
 * with the flag off, `getCatchmentProfile` returns before this is called.
 */
export function assembleCatchmentProfile(inputs: AssembleInputs): CatchmentProfile {
  const { areaKm2, grid, district, affluence } = inputs;

  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) {
    throw new Error(`assembleCatchmentProfile needs a positive areaKm2, got ${areaKm2}.`);
  }

  // No cells inside the radius is not "zero people" — it is "no data here".
  if (!grid || grid.cellCount <= 0 || !Number.isFinite(grid.total) || grid.total <= 0) {
    return unavailable(areaKm2);
  }
  if (grid.groups.length !== 1) {
    // Two vintages of the same product inside one radius would double-count.
    // Callers pin the source; reaching here means they did not.
    return unavailable(areaKm2);
  }

  const ageRatios = normaliseAgeRatios(district?.ageRatios);
  if (!district || !ageRatios) return unavailable(areaKm2);

  const avgSize = district.householdSizeAvg;
  if (
    typeof avgSize !== "number" ||
    !Number.isFinite(avgSize) ||
    avgSize < MIN_HOUSEHOLD_SIZE ||
    avgSize > MAX_HOUSEHOLD_SIZE
  ) {
    return unavailable(areaKm2);
  }

  if (!affluence) return unavailable(areaKm2);

  const gridGroup = grid.groups[0];
  if (!gridGroup) return unavailable(areaKm2);

  const total = Math.round(grid.total);
  const ageSplit: CatchmentAgeSplit = {
    under15: Math.round(total * ageRatios.under15),
    age15_40: Math.round(total * ageRatios.age15_40),
    age40_60: Math.round(total * ageRatios.age40_60),
    over60: Math.round(total * ageRatios.over60),
  };

  const provenance: ProvenanceEntry[] = [
    {
      field: "population.total",
      source: gridGroup.source,
      vintage: gridGroup.vintageYear,
      resolutionM: gridGroup.cellSizeM,
    },
    {
      field: "ageSplit",
      source: `${district.source} (district ${district.districtName}, not gridded)`,
      vintage: district.vintageYear,
      resolutionM: NOT_GRIDDED,
    },
    {
      field: "households.avgSize",
      source: `${district.source} (district ${district.districtName}, not gridded)`,
      vintage: district.vintageYear,
      resolutionM: NOT_GRIDDED,
    },
    {
      field: "affluence.tier",
      source: `derived from ${affluence.signals.length} signal(s): ${affluence.signals.join("; ")}`,
      vintage: district.vintageYear,
      resolutionM: NOT_GRIDDED,
    },
  ];

  return {
    available: true,
    areaKm2,
    population: {
      total,
      playingAge: ageSplit.age15_40,
      densityPerKm2: Math.round((total / areaKm2) * 10) / 10,
    },
    ageSplit,
    households: { count: Math.round(total / avgSize), avgSize },
    affluence,
    provenance,
  };
}
