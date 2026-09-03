/**
 * The scan result object.
 *
 * This shape is the Phase 1 → Phase 3/4 contract, documented in
 * `docs/PHASE-1-HANDOFF.md`. Two properties of it matter more than the rest:
 *
 * - **`categoryCounts` sums to more than `distinctPlaces`, on purpose.** A
 *   venue that is both a football turf and a cricket net counts in both
 *   categories. Reporting the distinct total separately is what stops the two
 *   numbers looking like a contradiction — and reporting only one of them is
 *   how v16 undercounted.
 *
 * - **`saturation` is never hidden.** If any tile came back with exactly the
 *   maximum result count for a term, the count for that term is a floor. The
 *   UI must be able to say "at least 47 schools", not "47 schools", because
 *   the second one is a claim we cannot support.
 */

import "server-only";

import { prisma, type Database } from "@/lib/scout/db";
import type { LatLng } from "@/lib/scout/geo/distance";

import { getScanCost } from "./metering";
import {
  getJobByScanId,
  getSaturationByTerm,
  getScan,
  getScanPlaces,
  type ScanPlaceRow,
} from "./scanRepository";
import { CATEGORIES, getCategory } from "./taxonomy";

export interface ScanProgress {
  readonly scanId: string;
  readonly jobStatus: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  /** 0–1. Failed tasks count as settled: the scan is not going to redo them. */
  readonly fraction: number;
  readonly label: string;
  readonly tileCount: number;
  readonly calls: number;
  readonly cacheHits: number;
  readonly costUsd: number;
  /**
   * True when the job is not finished and nobody holds a live lease — the
   * client should POST to the run endpoint to move it along. This is what
   * makes a scan survive a disconnect: the work is picked up, not restarted.
   */
  readonly resumeRequired: boolean;
  readonly error: string | null;
}

export async function getScanProgress(
  scanId: string,
  database: Database = prisma,
): Promise<ScanProgress | null> {
  const job = await getJobByScanId(scanId, database);
  if (!job) return null;

  const settled = job.completedTasks + job.failedTasks;
  const leaseLive = job.leaseExpiresAt !== null && job.leaseExpiresAt.getTime() > Date.now();
  const unfinished = job.status === "queued" || job.status === "running" || job.status === "paused";

  return {
    scanId,
    jobStatus: job.status,
    total: job.totalTasks,
    completed: job.completedTasks,
    failed: job.failedTasks,
    fraction: job.totalTasks === 0 ? 1 : Math.min(1, settled / job.totalTasks),
    label: job.progressLabel ?? "",
    tileCount: job.tileCount,
    calls: job.callCount,
    cacheHits: job.cacheHits,
    costUsd: Number(job.estimatedCostUsd),
    resumeRequired: unfinished && !leaseLive,
    error: job.lastError,
  };
}

export interface ScanResultPlace extends ScanPlaceRow {
  /** Distance rounded to the metre, for display. */
  readonly distanceMRounded: number;
}

export interface CategoryResult {
  readonly categoryId: string;
  readonly label: string;
  readonly side: "competition" | "demand";
  readonly count: number;
  /** True when any term in this category saturated any tile. */
  readonly saturated: boolean;
  readonly nearest: { placeId: string; name: string; distanceM: number } | null;
  readonly reviewTotal: number;
  readonly avgRating: number | null;
}

export interface ScanResult {
  readonly scanId: string;
  readonly areaLabel: string;
  readonly centre: LatLng;
  readonly radiusM: number;
  readonly status: string;
  readonly progress: ScanProgress | null;

  /** Every place, deduped globally by Google `place_id`. */
  readonly places: ScanResultPlace[];
  /** Distinct places. Always ≤ the sum of `categoryCounts`. */
  readonly distinctPlaces: number;
  readonly categories: CategoryResult[];
  readonly categoryCounts: Record<string, number>;

  readonly competitionCount: number;
  readonly demandCount: number;
  readonly reviewTotal: number;
  readonly avgRating: number | null;
  readonly nearestCompetitor: { placeId: string; name: string; distanceM: number } | null;

  readonly saturation: {
    /** Any term truncated anywhere — the UI must qualify every count. */
    readonly anySaturated: boolean;
    readonly terms: Array<{
      termId: string;
      termLabel: string;
      saturatedTiles: number;
      totalTiles: number;
    }>;
  };

  readonly cost: { calls: number; cacheHits: number; costUsd: number };
}

/**
 * Assemble the full result for a scan.
 *
 * Safe to call while the scan is still running — it returns whatever has
 * landed so far, which is what lets the UI paint results progressively instead
 * of staring at a spinner for two minutes.
 */
export async function getScanResult(
  scanId: string,
  database: Database = prisma,
): Promise<ScanResult | null> {
  const scan = await getScan(scanId, database);
  if (!scan) return null;

  const job = await getJobByScanId(scanId, database);
  const [rows, progress, cost, saturationRows] = await Promise.all([
    getScanPlaces(scanId, database),
    getScanProgress(scanId, database),
    getScanCost(scanId, database),
    job ? getSaturationByTerm(job.id, database) : Promise.resolve([]),
  ]);

  const places: ScanResultPlace[] = rows.map((r) => ({
    ...r,
    distanceMRounded: Math.round(r.distanceM),
  }));

  const saturatedTermIds = new Set(
    saturationRows.filter((s) => s.saturatedTiles > 0).map((s) => s.termId),
  );

  const categoryCounts: Record<string, number> = {};
  for (const place of places) {
    for (const categoryId of place.categories) {
      categoryCounts[categoryId] = (categoryCounts[categoryId] ?? 0) + 1;
    }
  }

  const categories: CategoryResult[] = Object.keys(categoryCounts)
    .map((categoryId) => {
      const definition = getCategory(categoryId);
      const members = places.filter((p) => p.categories.includes(categoryId));
      const rated = members.filter((p) => typeof p.rating === "number");
      const nearest = members.reduce<ScanResultPlace | null>(
        (best, p) => (!best || p.distanceM < best.distanceM ? p : best),
        null,
      );
      const termIds = definition?.terms.map((t) => t.id) ?? [];

      return {
        categoryId,
        label: definition?.label ?? categoryId,
        side: (definition?.side ?? members[0]?.side ?? "demand") as "competition" | "demand",
        count: members.length,
        saturated: termIds.some((id) => saturatedTermIds.has(id)),
        nearest: nearest
          ? {
              placeId: nearest.placeId,
              name: nearest.name,
              distanceM: nearest.distanceMRounded,
            }
          : null,
        reviewTotal: members.reduce((sum, p) => sum + (p.reviewCount ?? 0), 0),
        avgRating: rated.length
          ? Math.round((rated.reduce((s, p) => s + (p.rating ?? 0), 0) / rated.length) * 100) / 100
          : null,
      };
    })
    // Taxonomy order, so the UI never has to sort and two scans read alike.
    .sort((a, b) => categoryOrder(a.categoryId) - categoryOrder(b.categoryId));

  const competition = places.filter((p) => p.side === "competition");
  const demand = places.filter((p) => p.side === "demand");
  const ratedCompetition = competition.filter((p) => typeof p.rating === "number");
  const nearestCompetitor = competition.reduce<ScanResultPlace | null>(
    (best, p) => (!best || p.distanceM < best.distanceM ? p : best),
    null,
  );

  return {
    scanId,
    areaLabel: scan.areaLabel,
    centre: scan.centre,
    radiusM: scan.radiusM,
    status: scan.status,
    progress,
    places,
    distinctPlaces: places.length,
    categories,
    categoryCounts,
    competitionCount: competition.length,
    demandCount: demand.length,
    reviewTotal: competition.reduce((sum, p) => sum + (p.reviewCount ?? 0), 0),
    avgRating: ratedCompetition.length
      ? Math.round(
          (ratedCompetition.reduce((s, p) => s + (p.rating ?? 0), 0) / ratedCompetition.length) * 100,
        ) / 100
      : null,
    nearestCompetitor: nearestCompetitor
      ? {
          placeId: nearestCompetitor.placeId,
          name: nearestCompetitor.name,
          distanceM: nearestCompetitor.distanceMRounded,
        }
      : null,
    saturation: {
      anySaturated: saturatedTermIds.size > 0,
      terms: saturationRows,
    },
    cost,
  };
}

const CATEGORY_ORDER = new Map(CATEGORIES.map((c, i) => [c.id, i]));

function categoryOrder(id: string): number {
  return CATEGORY_ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;
}
