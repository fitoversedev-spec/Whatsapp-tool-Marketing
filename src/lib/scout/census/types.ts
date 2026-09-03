/**
 * The catchment profile contract.
 *
 * Population and census data are **deferred** (see `plan/IMPLEMENTATION-PLAN.md`
 * §3). In this build `getCatchmentProfile` always returns the `available: false`
 * branch. The shape below is what it will return once data is ingested.
 *
 * ## Why this is a discriminated union and not nullable fields
 *
 * The worst thing this project can produce is a report that implies a
 * population figure we do not have — a land owner sizing a capital investment
 * against an invented number. A flat object with optional fields lets a caller
 * write `profile.population?.total` and quietly get `undefined`, which then
 * formats as `0`, `NaN`, or an empty string somewhere downstream.
 *
 * With this union, `population` does not exist on the unavailable branch at
 * all, so `profile.population` is a **compile error** until the caller narrows
 * on `available`. That is the mechanism protecting the report, and
 * `tests/unit/catchmentProfile.types.test.ts` asserts it still holds.
 *
 * Do not add a `populationOrZero()` helper, a default value, or a merged
 * "flattened" view of this type. Each of those reintroduces exactly the failure
 * the union exists to prevent.
 */

/**
 * Why a catchment has no population figures.
 *
 * One member today. Widening this later is source-compatible for every caller
 * that narrows on `available` first, which is all of them.
 */
export type CatchmentUnavailableReason = "not_ingested";

export interface CatchmentUnavailable {
  available: false;
  reason: CatchmentUnavailableReason;
  /**
   * Always real. Derived from the radius alone, so it is meaningful even with
   * no population data, and downstream code uses it for density-free area
   * statements ("a 2 km catchment covering 12.6 km²").
   */
  areaKm2: number;
}

export interface CatchmentPopulation {
  /** Residents inside the catchment. Whole people. */
  total: number;
  /** Residents aged 15–40, the band that actually books a pitch. */
  playingAge: number;
  densityPerKm2: number;
}

/** Head counts, not ratios — the ratios come from the census, the totals from the grid. */
export interface CatchmentAgeSplit {
  under15: number;
  age15_40: number;
  age40_60: number;
  over60: number;
}

export interface CatchmentHouseholds {
  count: number;
  avgSize: number;
}

export type AffluenceTier = "A" | "B" | "C" | "D";

export type AffluenceConfidence = "high" | "medium" | "low";

export interface CatchmentAffluence {
  tier: AffluenceTier;
  /**
   * Human-readable list of the inputs that produced the tier, one per signal.
   * The report prints these verbatim — a tier with no visible workings is the
   * kind of black box this project does not ship.
   */
  signals: string[];
  confidence: AffluenceConfidence;
}

export interface ProvenanceEntry {
  /** Dotted path of the field this row explains, e.g. `population.total`. */
  field: string;
  source: string;
  vintage: number;
  /**
   * Grid resolution in metres. **`0` means the source is not a gridded product**
   * (census district tables, for instance). It is deliberately zero rather than
   * a plausible-looking figure like 50000, because a wrong number in a
   * provenance field is worse than an obviously absent one.
   */
  resolutionM: number;
}

export interface CatchmentAvailable {
  available: true;
  areaKm2: number;
  population: CatchmentPopulation;
  ageSplit: CatchmentAgeSplit;
  households: CatchmentHouseholds;
  affluence: CatchmentAffluence;
  provenance: ProvenanceEntry[];
}

export type CatchmentProfile = CatchmentUnavailable | CatchmentAvailable;

/**
 * Narrowing helper for call sites that would otherwise write `p.available`
 * inline. Purely ergonomic — it grants no access the union would not.
 */
export function hasPopulationData(profile: CatchmentProfile): profile is CatchmentAvailable {
  return profile.available;
}
