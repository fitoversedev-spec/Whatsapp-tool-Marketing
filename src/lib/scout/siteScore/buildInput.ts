import "server-only";

/**
 * The adapter between a scan and the scoring engine.
 *
 * Everything impure lives on this side of the line: the scan result, the city
 * benchmark, the cached review themes, the surveyor's checklist answers. What
 * crosses the line is a plain `ScoreInput` the engine fully owns — which is
 * what makes `computeScore` reproducible and this file the only place a change
 * in the database shape can affect a score.
 *
 * Three Phase 1 rules are honoured here rather than downstream:
 *
 * - Results are read through `getScanResult`, not re-derived from
 *   `scan_places`.
 * - `rating`, `reviewCount` and `businessStatus` are passed through as `null`
 *   when Google did not supply them. Nothing here coerces a missing value.
 * - `saturation.anySaturated` travels with the input, so no count downstream
 *   can be printed as exact when it is a floor.
 */

import { prisma, type Database } from "@/lib/scout/db";
import { getCityBenchmark, resolveScanCity } from "@/lib/scout/benchmarks";
import { getCatchmentProfile } from "@/lib/scout/census";
import { getScanResult, type ScanResult } from "@/lib/scout/places/scanResult";
import { resolveTerms } from "@/lib/scout/places/taxonomy";
import { loadScanThemeState, type ScanThemeState } from "@/lib/scout/reviews";
import { sanitiseSurveyorInputs } from "@/lib/scout/scoring";
import type { ScannedFormat, ScoreInput } from "@/lib/scout/scoring";

export interface ScoreInputBundle {
  readonly input: ScoreInput;
  readonly scanResult: ScanResult;
  readonly themeState: ScanThemeState;
  readonly city: string | null;
  /** Verbatim review quotes, for the report. Not used by the score itself. */
  readonly evidence: ScanThemeState["evidence"];
}

export class ScanNotFoundError extends Error {
  constructor(scanId: string) {
    super(`Scan ${scanId} does not exist.`);
    this.name = "ScanNotFoundError";
  }
}

/**
 * The competition terms this scan actually searched for.
 *
 * Read from `scans.search_terms`, which stores the plan as it was executed —
 * not from the current taxonomy. "This format has demand and no supply" is
 * only provable for a format the scan looked for; claiming a gap in something
 * nobody searched would be inventing a finding.
 */
export function scannedFormatsFor(searchTerms: unknown): ScannedFormat[] {
  const record = (searchTerms ?? {}) as { categoryIds?: unknown; termIds?: unknown };
  const categoryIds = Array.isArray(record.categoryIds) ? record.categoryIds.map(String) : [];
  const termIds = new Set(Array.isArray(record.termIds) ? record.termIds.map(String) : []);

  return resolveTerms(categoryIds)
    .filter((t) => t.side === "competition" && t.term.sportFormat && termIds.has(t.term.id))
    .map((t) => ({
      termId: t.term.id,
      label: t.term.label,
      sportFormat: t.term.sportFormat!,
    }));
}

export async function buildScoreInput(
  scanId: string,
  database: Database = prisma,
): Promise<ScoreInputBundle> {
  const scanRow = await database.scan.findUnique({
    where: { id: scanId },
    select: {
      id: true,
      areaLabel: true,
      address: true,
      searchTerms: true,
      surveyorInputs: true,
      // Was a LEFT JOIN onto `sites`; the scan may have no site.
      site: { select: { city: true } },
    },
  });

  if (!scanRow) throw new ScanNotFoundError(scanId);

  const [scanResult, themeState] = await Promise.all([
    getScanResult(scanId, database),
    loadScanThemeState(scanId, database),
  ]);
  if (!scanResult) throw new ScanNotFoundError(scanId);

  const city = resolveScanCity({ siteCity: scanRow.site?.city ?? null, address: scanRow.address });

  /**
   * The all-formats benchmark, not a per-format one. The saturation component
   * measures total supply against total demand anchors; comparing that to a
   * single format's median would be comparing two different quantities.
   */
  const benchmark = city ? await getCityBenchmark(city, null, database) : null;

  const surveyor = sanitiseSurveyorInputs(scanRow.surveyorInputs);

  /**
   * Ask Phase 2 rather than reading the feature flag.
   *
   * The answer is `{ available: false, reason: "not_ingested" }` in every scan
   * of this build and the call short-circuits before it touches PostGIS, so
   * this costs nothing today. It is here because it is the seam: switching
   * population on becomes a data load plus score model v2.0.0, with no edit to
   * this adapter. Reading `populationAvailable` instead would have left the
   * seam documented but never exercised, which is how a seam rots.
   *
   * The union means nothing downstream can reach `profile.population` without
   * narrowing — see `docs/PHASE-2-HANDOFF.md` before touching that.
   */
  const catchment = await getCatchmentProfile(
    scanResult.centre.lat,
    scanResult.centre.lng,
    scanResult.radiusM,
  );

  const input: ScoreInput = {
    scanId,
    areaLabel: scanResult.areaLabel,
    radiusM: scanResult.radiusM,
    city,
    places: scanResult.places.map((p) => ({
      placeId: p.placeId,
      name: p.name,
      side: p.side,
      categories: p.categories,
      matchedTerms: p.matchedTerms,
      distanceM: p.distanceM,
      rating: p.rating,
      reviewCount: p.reviewCount,
      businessStatus: p.businessStatus,
    })),
    scannedFormats: scannedFormatsFor(scanRow.searchTerms),
    anySaturated: scanResult.saturation.anySaturated,
    saturatedTermLabels: scanResult.saturation.terms
      .filter((t) => t.saturatedTiles > 0)
      .map((t) => t.termLabel),
    benchmark: benchmark
      ? {
          city: benchmark.city,
          anchorsPerFacility: benchmark.anchorsPerFacility,
          medianRating: benchmark.medianRating,
          sampleCount: benchmark.sampleCount,
        }
      : null,
    reviewThemes: themeState.themes,
    themesExtracted: themeState.themesExtracted,
    // An empty object means "surveyed nothing", which the engine treats as no
    // survey. `null` and `{}` are equivalent here on purpose: both mean the
    // component is excluded rather than scored as zero.
    surveyor: Object.keys(surveyor).length > 0 ? surveyor : null,
    populationAvailable: catchment.available,
  };

  return { input, scanResult, themeState, city, evidence: themeState.evidence };
}
