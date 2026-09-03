import "server-only";

/**
 * `getCatchmentProfile` — the load-bearing deliverable of Phase 2.
 *
 * In this build it always returns
 * `{ available: false, reason: "not_ingested", areaKm2 }`, because population
 * and census data are deferred. `areaKm2` is real and computed from the radius.
 *
 * Switching population on is:
 *   1. run the ingest scripts in `scripts/ingest/`
 *   2. set `NEXT_PUBLIC_POPULATION_DATA_ENABLED=true` and redeploy
 *
 * Nothing below changes. The full path — grid sum, nearest district, affluence,
 * assembly — is implemented and tested against fixtures today.
 */
import { deriveAffluence, type AffluenceSignalInputs } from "./affluence";
import { isPopulationEnabled } from "./disclosure";
import { assertValidCatchment, catchmentAreaKm2 } from "./geo";
import { assembleCatchmentProfile } from "./profile";
import { findNearestCensusDistrict, sumPopulationWithin } from "./queries";
import type { PopulationSourceFilter } from "./queries";
import type { CatchmentProfile } from "./types";

export interface CatchmentProfileOptions {
  /**
   * Pin which population product to read when more than one is loaded.
   * Without it, a radius overlapping two vintages resolves to unavailable
   * rather than to a doubled total.
   */
  source?: PopulationSourceFilter;
  /**
   * Affluence signals the caller already holds — Phase 3 has the median Google
   * `priceLevel` of nearby food and drink from the places it just scanned, and
   * re-deriving it here would mean a second pass over the same rows.
   */
  affluenceSignals?: AffluenceSignalInputs;
}

/**
 * Population, age structure, households and affluence for a catchment — or an
 * explicit statement that we do not have them.
 *
 * Callers must narrow on `available` before touching any population field;
 * `CatchmentProfile` is a discriminated union precisely so the compiler
 * enforces that. See `src/lib/census/types.ts`.
 *
 * Throws `InvalidCatchmentError` on impossible coordinates or radii. That is a
 * caller bug, and returning `available: false` for it would hide the bug behind
 * a legitimate-looking answer.
 */
export async function getCatchmentProfile(
  lat: number,
  lng: number,
  radiusM: number,
  options: CatchmentProfileOptions = {},
): Promise<CatchmentProfile> {
  assertValidCatchment(lat, lng, radiusM);
  const areaKm2 = catchmentAreaKm2(radiusM);

  // The default path in this build. No database round-trip at all, which is
  // also why this comfortably beats the 500 ms budget.
  if (!isPopulationEnabled()) {
    return { available: false, reason: "not_ingested", areaKm2 };
  }

  const [grid, district] = await Promise.all([
    sumPopulationWithin(lat, lng, radiusM, options.source ?? {}),
    findNearestCensusDistrict(lat, lng),
  ]);

  const affluence = deriveAffluence({
    urbanShare: district?.urbanShare ?? null,
    ...options.affluenceSignals,
  });

  return assembleCatchmentProfile({ areaKm2, grid, district, affluence });
}
