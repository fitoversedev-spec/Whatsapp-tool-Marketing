import "server-only";

import { prisma } from "@/lib/scout/db";
import { canAccessAllScans, type ScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getScanResult } from "@/lib/scout/places/scanResult";
import { sanitiseSurveyorInputs } from "@/lib/scout/scoring/checklist";
import type { ScoreResult } from "@/lib/scout/scoring/types";

import { readCategoryIds } from "./queries";
import type { ScanScreenData } from "./dto";

/**
 * Assemble the D2 payload for one scan.
 *
 * Returns `null` for a scan the caller may not read — the same 404-not-403 rule
 * the APIs use, for the same reason: confirming the id exists is itself a leak.
 *
 * Safe to call mid-scan. `getScanResult` returns whatever has landed so far, so
 * the screen paints results progressively instead of holding a spinner for two
 * minutes while a tiled scan works through its tasks.
 */
export async function getScanScreenData(
  identity: ScoutIdentity,
  scanId: string,
): Promise<ScanScreenData | null> {
  const scan = await getScan(scanId);
  if (!scan) return null;
  if (scan.ownerId !== identity.userId && !canAccessAllScans(identity)) return null;

  const [result, row] = await Promise.all([
    getScanResult(scanId),
    prisma.scan.findUnique({
      where: { id: scanId },
      select: {
        address: true,
        customerName: true,
        scoreBreakdown: true,
        scoredAt: true,
        surveyorInputs: true,
        fieldNotes: true,
      },
    }),
  ]);

  if (!result) return null;

  const score = (row?.scoreBreakdown as unknown as ScoreResult | null) ?? null;

  return {
    scanId: result.scanId,
    areaLabel: result.areaLabel,
    address: row?.address ?? null,
    customerName: row?.customerName ?? null,
    centre: result.centre,
    radiusM: result.radiusM,
    status: result.status,
    categoryIds: readCategoryIds(scan.searchTerms),

    places: result.places.map((p) => ({
      placeId: p.placeId,
      name: p.name,
      lat: p.location.lat,
      lng: p.location.lng,
      distanceM: p.distanceMRounded,
      side: p.side,
      categories: p.categories,
      rating: p.rating,
      reviewCount: p.reviewCount,
      primaryTypeDisplayName: p.primaryTypeDisplayName,
      businessStatus: p.businessStatus,
      googleMapsUri: p.googleMapsUri,
    })),
    distinctPlaces: result.distinctPlaces,
    categories: result.categories.map((c) => ({
      categoryId: c.categoryId,
      label: c.label,
      side: c.side,
      count: c.count,
      saturated: c.saturated,
      reviewTotal: c.reviewTotal,
      avgRating: c.avgRating,
      nearestM: c.nearest?.distanceM ?? null,
    })),
    categoryCounts: result.categoryCounts,

    competitionCount: result.competitionCount,
    demandCount: result.demandCount,
    reviewTotal: result.reviewTotal,
    avgRating: result.avgRating,

    anySaturated: result.saturation.anySaturated,
    saturatedTerms: result.saturation.terms.filter((t) => t.saturatedTiles > 0),

    progress: result.progress
      ? {
          jobStatus: result.progress.jobStatus,
          total: result.progress.total,
          completed: result.progress.completed,
          failed: result.progress.failed,
          fraction: result.progress.fraction,
          label: result.progress.label,
          tileCount: result.progress.tileCount,
          calls: result.progress.calls,
          cacheHits: result.progress.cacheHits,
          costUsd: result.progress.costUsd,
          resumeRequired: result.progress.resumeRequired,
          error: result.progress.error,
        }
      : null,
    cost: result.cost,

    score,
    scoredAt: row?.scoredAt ? row.scoredAt.toISOString() : null,
    surveyorInputs: sanitiseSurveyorInputs(row?.surveyorInputs),
    fieldNotes: row?.fieldNotes ?? null,
  };
}
