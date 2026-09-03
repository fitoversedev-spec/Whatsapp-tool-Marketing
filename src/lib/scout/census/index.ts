/**
 * Census & population — **scaffolding only**. No data is ingested in this build.
 *
 * Server code should import from here. **Client components must import
 * `@/lib/scout/census/disclosure` directly** — this barrel pulls in `server-only` and
 * the Postgres driver via `catchment.ts`, and re-exporting the flag from here
 * would drag both into the browser bundle.
 *
 * See `docs/PHASE-2-HANDOFF.md` for the switch-on procedure.
 */
export { getCatchmentProfile } from "./catchment";
export type { CatchmentProfileOptions } from "./catchment";

export type {
  AffluenceConfidence,
  AffluenceTier,
  CatchmentAffluence,
  CatchmentAgeSplit,
  CatchmentAvailable,
  CatchmentHouseholds,
  CatchmentPopulation,
  CatchmentProfile,
  CatchmentUnavailable,
  CatchmentUnavailableReason,
  ProvenanceEntry,
} from "./types";
export { hasPopulationData } from "./types";

export {
  BENCHMARK_INDICATIVE_BELOW,
  benchmarkSampleCaveat,
  isPopulationEnabled,
  LIMITATIONS_HEADING,
  POPULATION_LIMITATION_TEXT,
  populationAvailable,
  populationLimitations,
  SATURATION_METHOD_NOTE,
} from "./disclosure";

export {
  assertValidCatchment,
  catchmentAreaKm2,
  InvalidCatchmentError,
  MAX_CATCHMENT_RADIUS_M,
} from "./geo";

export { deriveAffluence } from "./affluence";
export type { AffluenceSignalInputs } from "./affluence";

export { assembleCatchmentProfile, normaliseAgeRatios } from "./profile";
export type {
  AgeBand,
  AssembleInputs,
  CensusDistrictRatios,
  PopulationGridGroup,
  PopulationGridSum,
} from "./profile";

export {
  findNearestCensusDistrict,
  MAX_DISTRICT_CENTROID_DISTANCE_M,
  populationDataStatus,
  sumPopulationWithin,
} from "./queries";
export type { PopulationSourceFilter } from "./queries";
