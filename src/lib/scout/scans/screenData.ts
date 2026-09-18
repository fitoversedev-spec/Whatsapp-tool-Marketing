import "server-only";

import { prisma } from "@/lib/scout/db";
import { canAccessAllScans, type ScoutIdentity } from "@/lib/scout/identity";
import { getExclusionsForOwner } from "@/lib/scout/places/exclusionRepository";
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

  const [result, row, exclusions] = await Promise.all([
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
    getExclusionsForOwner(scan.ownerId),
  ]);

  if (!result) return null;

  const excludedSet = new Map<string, { id: string; locked: boolean; categoryId: string }[]>();
  for (const ex of exclusions) {
    const list = excludedSet.get(ex.googlePlaceId) ?? [];
    list.push({ id: ex.id, locked: ex.locked, categoryId: ex.categoryId });
    excludedSet.set(ex.googlePlaceId, list);
  }

  const filteredPlaces = result.places.filter((p) => {
    const exList = excludedSet.get(p.placeId);
    if (!exList) return true;
    const remaining = p.categories.filter(
      (catId) => !exList.some((ex) => ex.categoryId === catId),
    );
    return remaining.length > 0;
  });

  const categoryLabelMap = new Map(result.categories.map((c) => [c.categoryId, c.label]));
  const excludedPlaceDetails = exclusions.flatMap((ex) => {
    const place = result.places.find((p) => p.placeId === ex.googlePlaceId);
    if (!place) return [];
    return [{
      exclusionId: ex.id,
      categoryId: ex.categoryId,
      categoryLabel: categoryLabelMap.get(ex.categoryId) ?? ex.categoryId,
      place: {
        placeId: place.placeId,
        name: place.name,
        lat: place.location.lat,
        lng: place.location.lng,
        distanceM: place.distanceMRounded,
        side: place.side,
        categories: place.categories,
        rating: place.rating,
        reviewCount: place.reviewCount,
        primaryTypeDisplayName: place.primaryTypeDisplayName,
        businessStatus: place.businessStatus,
        googleMapsUri: place.googleMapsUri,
        flooring: place.flooring,
        flooringDetail: place.flooringDetail,
      },
    }];
  });

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

    places: filteredPlaces.map((p) => ({
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
      flooring: p.flooring,
      flooringDetail: p.flooringDetail,
    })),
    distinctPlaces: filteredPlaces.length,
    categories: result.categories
      .map((c) => {
        const members = filteredPlaces.filter((p) => p.categories.includes(c.categoryId));
        const rated = members.filter((p) => typeof p.rating === "number");
        return {
          categoryId: c.categoryId,
          label: c.label,
          side: c.side,
          count: members.length,
          saturated: c.saturated,
          reviewTotal: members.reduce((sum, p) => sum + (p.reviewCount ?? 0), 0),
          avgRating: rated.length
            ? Math.round((rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length) * 100) / 100
            : null,
          nearestM: members.length
            ? Math.min(...members.map((p) => p.distanceMRounded))
            : null,
        };
      })
      .filter((c) => c.count > 0),
    categoryCounts: Object.fromEntries(
      result.categories
        .map((c) => [c.categoryId, filteredPlaces.filter((p) => p.categories.includes(c.categoryId)).length] as const)
        .filter(([, count]) => count > 0),
    ),

    competitionCount: filteredPlaces.filter((p) => p.side === "competition").length,
    demandCount: filteredPlaces.filter((p) => p.side === "demand").length,
    reviewTotal: filteredPlaces.reduce((sum, p) => sum + (p.reviewCount ?? 0), 0),
    avgRating: (() => {
      const rated = filteredPlaces.filter((p) => p.side === "competition" && typeof p.rating === "number");
      return rated.length
        ? Math.round((rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length) * 100) / 100
        : null;
    })(),

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

    exclusions: exclusions.map((ex) => ({
      id: ex.id,
      googlePlaceId: ex.googlePlaceId,
      categoryId: ex.categoryId,
      locked: ex.locked,
    })),
    excludedPlaceDetails,
  };
}
