/**
 * The scan pipeline.
 *
 * ## Why this is a job and not a request
 *
 * A 2 km scan with a Standard preset is ~19 tiles × ~19 terms of work; a Full
 * sweep at 3 km is several hundred billable calls. That runs far past any
 * serverless function timeout, so `POST /api/scout/scans` **creates** a job and
 * returns; this module **processes** it in bounded slices.
 *
 * Each slice:
 *   1. takes an exclusive lease on the job;
 *   2. claims a handful of pending tasks and runs them in parallel;
 *   3. writes results and progress after every task;
 *   4. stops when its wall-clock budget runs out and releases the lease.
 *
 * Nothing is held in memory between slices. A worker killed mid-tile loses at
 * most the tasks it had in flight, which return to `pending` when its lease
 * lapses — so a field scan that dies at tile 6 of 8 on bad mobile signal
 * resumes rather than restarts, which is what Phase 5 needs.
 *
 * ## What it does not do
 *
 * No scoring (Phase 3), no review analysis (Phase 3), no UI. It ingests.
 */

import "server-only";

import { prisma, type Database, type DatabaseClient } from "@/lib/scout/db";
import { haversineDistanceM, type LatLng } from "@/lib/scout/geo/distance";
import { planTiles, type Tile } from "@/lib/scout/geo/tiling";

import {
  readPlaceCache,
  readSearchCache,
  searchCacheKey,
  upsertPlaces,
  upsertReviews,
  writeSearchCache,
} from "./cache";
import { NEARBY_MAX_RESULTS, placesConfig, TEXT_MAX_PAGES, TEXT_MAX_RESULTS } from "./config";
import { estimateScan, type ScanEstimate } from "./estimate";
import { CircuitOpenError, GoogleClient } from "./googleClient";
import type { GooglePlace } from "./googleTypes";
import { assertWithinDailyCap, DailyCapExceededError, recordCacheHit, recordCalls } from "./metering";
import { normalisePlace, type NormalisedPlace } from "./normalise";
import {
  attachPlacesToScan,
  claimJob,
  claimTasks,
  completeTask,
  countTaskStatuses,
  createScanWithJob,
  failTask,
  finaliseScan,
  getJobByScanId,
  getSaturationByTerm,
  getScan,
  getScanPlaces,
  releaseJob,
  releaseRunningTasks,
  renewLease,
  updateJobProgress,
  type ClaimedTask,
  type ScanPlaceRow,
} from "./scanRepository";
import { getCategory, resolveTerms, unknownCategoryIds, type SkuTier } from "./taxonomy";

export class ScanRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ScanRequestError";
  }
}

/* --------------------------------------------------------------- creation */

export interface CreateScanRequest {
  readonly ownerId: string;
  readonly areaLabel: string;
  readonly centre: LatLng;
  readonly radiusM: number;
  readonly categoryIds: readonly string[];
  readonly siteId?: string | null;
  readonly customerName?: string | null;
  readonly address?: string | null;
}

export interface CreateScanResult {
  readonly scanId: string;
  readonly jobId: string;
  readonly totalTasks: number;
  readonly tileCount: number;
  readonly estimate: ScanEstimate;
}

/**
 * Validate, plan and persist a scan. Returns immediately — no Google call is
 * made here.
 *
 * Validation is deliberately strict and up front: a plan that would blow the
 * tile ceiling or the daily cap should be refused before a row exists, not
 * discovered by a worker forty calls in.
 */
export async function createScan(
  request: CreateScanRequest,
  database: DatabaseClient = prisma,
): Promise<CreateScanResult> {
  const { centre, radiusM } = request;

  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    throw new ScanRequestError(`radiusM must be a positive number, got ${radiusM}`, "BAD_RADIUS");
  }
  if (request.categoryIds.length === 0) {
    throw new ScanRequestError("Select at least one category to scan.", "NO_CATEGORIES");
  }

  const unknown = unknownCategoryIds(request.categoryIds);
  if (unknown.length > 0) {
    throw new ScanRequestError(`Unknown categories: ${unknown.join(", ")}`, "UNKNOWN_CATEGORY");
  }

  const tileRadiusM = placesConfig.tileRadiusM;
  const tileOverlap = placesConfig.tileOverlap;

  let tiles: Tile[];
  try {
    tiles = planTiles({
      centre,
      radiusM,
      tileRadiusM,
      overlap: tileOverlap,
      maxTiles: placesConfig.maxTilesPerScan,
    });
  } catch (error) {
    throw new ScanRequestError(
      error instanceof Error ? error.message : String(error),
      "TILE_PLAN_REJECTED",
    );
  }

  const terms = resolveTerms(request.categoryIds);
  const estimate = estimateScan({
    categoryIds: request.categoryIds,
    radiusM,
    tileRadiusM,
    tileOverlap,
  });

  // Refuse before spending anything, with the number that caused the refusal.
  await assertWithinDailyCap(request.ownerId, estimate.minCalls, database);

  const created = await createScanWithJob(
    {
      ownerId: request.ownerId,
      siteId: request.siteId ?? null,
      areaLabel: request.areaLabel,
      customerName: request.customerName ?? null,
      address: request.address ?? null,
      centre,
      radiusM,
      categoryIds: request.categoryIds,
      tileRadiusM,
      tileOverlap,
    },
    tiles,
    terms,
    database,
  );

  return { ...created, estimate };
}

/* ---------------------------------------------------------------- running */

export interface RunOptions {
  /** Wall-clock budget for this slice. Defaults to `SCAN_WORKER_BUDGET_MS`. */
  readonly budgetMs?: number;
  readonly client?: GoogleClient;
  readonly now?: () => number;
  /**
   * Hard ceiling on how many tasks this slice will process in total.
   *
   * Bounding a slice by task count rather than by clock is what a test — or a
   * cron that wants small, predictable units of work — actually needs. Bounding
   * it by a tiny `budgetMs` instead is a race: whether the loop runs at all
   * depends on how the millisecond falls.
   */
  readonly maxTasks?: number;
}

export interface RunResult {
  readonly scanId: string;
  readonly status: "completed" | "paused" | "failed" | "busy" | "not-found";
  readonly done: number;
  readonly failed: number;
  readonly pending: number;
  readonly total: number;
  readonly calls: number;
  readonly cacheHits: number;
  readonly costUsd: number;
  readonly progressLabel: string;
  readonly error?: string;
}

/**
 * Process one slice of a scan job.
 *
 * Safe to call repeatedly and safe to call concurrently — a second caller
 * arriving while a worker holds the lease gets `status: "busy"` rather than
 * duplicating the work, which on a billable API is the difference between one
 * invoice and two.
 */
export async function runScanSlice(
  scanId: string,
  options: RunOptions = {},
  database: Database = prisma,
): Promise<RunResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? placesConfig.workerBudgetMs);

  const scan = await getScan(scanId, database);
  if (!scan) {
    return emptyResult(scanId, "not-found");
  }

  const lease = await claimJob(scanId, database);
  if (!lease) {
    const counts = await currentCounts(scanId, database);
    return { ...counts, scanId, status: "busy", progressLabel: "Another worker is running this scan" };
  }

  const client = options.client ?? new GoogleClient();
  let calls = 0;
  let cacheHits = 0;
  let costUsd = 0;
  let fatal: Error | undefined;

  const taskCeiling = options.maxTasks ?? Number.POSITIVE_INFINITY;
  let tasksThisSlice = 0;

  try {
    while (now() < deadline && tasksThisSlice < taskCeiling) {
      const batch = await claimTasks(
        lease.jobId,
        Math.min(placesConfig.concurrency, taskCeiling - tasksThisSlice),
        database,
      );
      if (batch.length === 0) break;
      tasksThisSlice += batch.length;

      // The daily cap is re-checked each batch, not only at creation: a scan
      // runs over minutes and the same user may be running another alongside.
      try {
        await assertWithinDailyCap(scan.ownerId, batch.length, database);
      } catch (error) {
        await releaseRunningTasks(lease.jobId, database);
        if (error instanceof DailyCapExceededError) {
          fatal = error;
          break;
        }
        throw error;
      }

      const outcomes = await Promise.all(
        batch.map((task) =>
          runTask({ scan, task, client, database }).catch((error: unknown) => ({
            task,
            error: error instanceof Error ? error : new Error(String(error)),
          })),
        ),
      );

      // Every task in the batch settles independently, so they settle together.
      await Promise.all(
        outcomes.map((outcome) => {
          if ("error" in outcome) {
            // A dead API must fail the whole slice at once rather than burning
            // every remaining tile against a circuit that is already open.
            if (outcome.error instanceof CircuitOpenError) fatal = outcome.error;
            return failTask(
              outcome.task.id,
              outcome.error.message,
              outcome.task.attempts,
              database,
            );
          }
          calls += outcome.calls;
          cacheHits += outcome.cacheHits;
          costUsd += outcome.costUsd;
          return completeTask(
            outcome.task.id,
            {
              resultCount: outcome.kept,
              saturated: outcome.saturated,
              callCount: outcome.calls,
            },
            database,
          );
        }),
      );

      const counts = await countTaskStatuses(lease.jobId, database);
      const label = describeProgress(batch[batch.length - 1], counts.done, counts.total);
      await Promise.all([
        updateJobProgress(
          lease.jobId,
          {
            completedTasks: counts.done,
            failedTasks: counts.failed,
            progressLabel: label,
            callsDelta: calls,
            cacheHitsDelta: cacheHits,
            costDelta: costUsd,
          },
          database,
        ),
        // Renewed alongside the progress write rather than after it: the lease
        // is about staying alive, and it should not wait its turn behind
        // bookkeeping.
        fatal ? Promise.resolve(true) : renewLease(lease, database),
      ]);
      calls = 0;
      cacheHits = 0;
      costUsd = 0;

      if (fatal) break;
    }

    // Anything still `running` was claimed but not finished inside the budget.
    await releaseRunningTasks(lease.jobId, database);

    const counts = await countTaskStatuses(lease.jobId, database);
    const finished = counts.pending === 0;

    if (finished && !fatal) {
      await finalise(scanId, lease.jobId, database);
      await releaseJob(lease, "completed", {}, database);
      const job = await getJobByScanId(scanId, database);
      return {
        scanId,
        status: "completed",
        done: counts.done,
        failed: counts.failed,
        pending: 0,
        total: counts.total,
        calls: job?.callCount ?? 0,
        cacheHits: job?.cacheHits ?? 0,
        costUsd: Number(job?.estimatedCostUsd ?? 0),
        progressLabel: "Scan complete",
      };
    }

    await releaseJob(lease, "paused", { lastError: fatal?.message ?? null }, database);
    const job = await getJobByScanId(scanId, database);
    return {
      scanId,
      status: fatal ? "failed" : "paused",
      done: counts.done,
      failed: counts.failed,
      pending: counts.pending,
      total: counts.total,
      calls: job?.callCount ?? 0,
      cacheHits: job?.cacheHits ?? 0,
      costUsd: Number(job?.estimatedCostUsd ?? 0),
      progressLabel: fatal ? "Scan stopped" : (job?.progressLabel ?? "Paused"),
      error: fatal?.message,
    };
  } catch (error) {
    await releaseRunningTasks(lease.jobId, database).catch(() => undefined);
    await releaseJob(
      lease,
      "paused",
      { lastError: error instanceof Error ? error.message : String(error) },
      database,
    ).catch(() => undefined);
    throw error;
  }
}

/**
 * Drive a scan to completion by running slices back to back.
 *
 * Convenience for a cron worker or a local script — **not** for a request
 * handler, which is exactly what this whole design exists to avoid.
 */
export async function runScanToCompletion(
  scanId: string,
  options: RunOptions & { maxSlices?: number } = {},
  database: Database = prisma,
): Promise<RunResult> {
  const maxSlices = options.maxSlices ?? 100;
  let last: RunResult = emptyResult(scanId, "paused");

  for (let slice = 0; slice < maxSlices; slice += 1) {
    last = await runScanSlice(scanId, options, database);
    if (last.status !== "paused") return last;
    if (last.pending === 0) return last;
  }
  return last;
}

/* ------------------------------------------------------------- one task */

interface TaskContext {
  readonly scan: { id: string; ownerId: string; centre: LatLng; radiusM: number };
  readonly task: ClaimedTask;
  readonly client: GoogleClient;
  readonly database: Database;
}

interface TaskOutcome {
  readonly task: ClaimedTask;
  /** Places kept after the geodesic filter. */
  readonly kept: number;
  readonly saturated: boolean;
  readonly calls: number;
  readonly cacheHits: number;
  readonly costUsd: number;
}

/**
 * Run one (tile, term) search end to end: cache check, Google call, geodesic
 * filter, persist, attach to the scan.
 */
async function runTask(ctx: TaskContext): Promise<TaskOutcome> {
  const { scan, task, client, database } = ctx;
  const tier = task.fieldTier as SkuTier;
  const category = getCategory(task.categoryId);
  const term = category?.terms.find((t) => t.id === task.termId);

  if (!term) {
    // The taxonomy changed under a scan planned against an older version.
    // Skipping is right: inventing a search for a term nobody defined is worse.
    return { task, kept: 0, saturated: false, calls: 0, cacheHits: 0, costUsd: 0 };
  }

  const cacheKeyParts = {
    centre: task.tileCentre,
    radiusM: task.tileRadiusM,
    termId: task.termId,
    mode: term.mode,
    tier,
  };
  const key = searchCacheKey(cacheKeyParts);

  const cached = await readSearchCache(key, tier, database);
  if (cached) {
    // A hit still has to attach the places to *this* scan; what it skips is
    // the billable call. That is the whole saving on a repeat scan.
    const kept = await attachCachedPlaces(ctx, cached.googlePlaceIds);
    await recordCacheHit(
      {
        userId: scan.ownerId,
        scanId: scan.id,
        endpoint: term.mode === "nearby" ? "searchNearby" : "searchText",
        skuTier: tier,
        savedCalls: cached.callCount,
      },
      database,
    );
    return {
      task,
      kept,
      saturated: cached.saturated,
      calls: 0,
      cacheHits: cached.callCount,
      costUsd: 0,
    };
  }

  const startedAt = Date.now();
  const googlePlaces: GooglePlace[] = [];
  let calls = 0;
  let saturated = false;

  if (term.mode === "nearby") {
    const result = await client.searchNearby({
      centre: task.tileCentre,
      radiusM: task.tileRadiusM,
      includedTypes: term.googleTypes ?? [],
      tier,
    });
    googlePlaces.push(...result.places);
    calls = result.calls;
    // Nearby Search caps at 20 with no pagination, so exactly 20 back means
    // the tile may still be truncated. Flagged, never silently swallowed.
    saturated = result.places.length >= NEARBY_MAX_RESULTS;
  } else {
    for (const query of term.queries ?? []) {
      const result = await client.searchTextPaged(
        {
          centre: task.tileCentre,
          radiusM: task.tileRadiusM,
          textQuery: query,
          tier,
        },
        TEXT_MAX_PAGES,
      );
      googlePlaces.push(...result.places);
      calls += result.calls;
      // Google stops at 60 results across all pages. Hitting that, or still
      // having a page token when we stop, means there was more to see.
      if (result.places.length >= TEXT_MAX_RESULTS || result.nextPageToken) saturated = true;
    }
  }

  const kept = await persistPlaces(ctx, googlePlaces, tier);

  // Metering and the search-cache write are independent of each other; only
  // the place ids they both need had to come first.
  const [costUsd] = await Promise.all([
    recordCalls(
      {
        userId: scan.ownerId,
        scanId: scan.id,
        endpoint: term.mode === "nearby" ? "searchNearby" : "searchText",
        skuTier: tier,
        callCount: calls,
        latencyMs: Date.now() - startedAt,
      },
      database,
    ),
    writeSearchCache(
      {
        ...cacheKeyParts,
        googlePlaceIds: kept.googlePlaceIds,
        saturated,
        callCount: calls,
      },
      database,
    ),
  ]);

  return { task, kept: kept.count, saturated, calls, cacheHits: 0, costUsd };
}

/**
 * Normalise, distance-filter and persist a tile's results.
 *
 * The distance filter is against the **scan centre**, not the tile centre:
 * tiles deliberately overlap the catchment boundary, and a place found in the
 * outer half of an edge tile can be well outside the radius the surveyor asked
 * about. Measured geodesically, so the boundary means what it says.
 */
async function persistPlaces(
  ctx: TaskContext,
  googlePlaces: readonly GooglePlace[],
  tier: SkuTier,
): Promise<{ count: number; googlePlaceIds: string[] }> {
  const { scan, task, database } = ctx;

  const kept: Array<{ place: NormalisedPlace; distanceM: number }> = [];
  const seen = new Set<string>();

  for (const raw of googlePlaces) {
    const place = normalisePlace(raw);
    if (!place) continue;
    // One tile can return the same place twice across a term's query strings.
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);

    const distanceM = haversineDistanceM(scan.centre, place.location);
    if (distanceM > scan.radiusM) continue;

    kept.push({ place, distanceM });
  }

  if (kept.length === 0) return { count: 0, googlePlaceIds: [] };

  // Three statements for the whole tile, not three per place. A saturated
  // tile carries twenty places, and a scan runs dozens of tiles — at one
  // round trip each that is minutes of latency against a database in
  // Singapore, for work that batches perfectly.
  const uuids = await upsertPlaces(
    kept.map((k) => k.place),
    tier,
    database,
  );

  const withReviews = kept
    .filter((k) => k.place.reviews.length > 0)
    .map((k) => ({ placeUuid: uuids.get(k.place.placeId)!, reviews: k.place.reviews }))
    .filter((entry) => entry.placeUuid);

  // Reviews and scan membership touch different tables and neither depends on
  // the other, so they go out together. Round trips to Singapore cost ~60 ms
  // each; serialising them for no reason is most of a scan's wall clock.
  await Promise.all([
    withReviews.length > 0 ? upsertReviews(withReviews, database) : Promise.resolve(0),
    attachPlacesToScan(
      kept.map((k) => ({
        scanId: scan.id,
        placeUuid: uuids.get(k.place.placeId)!,
        categoryId: task.categoryId,
        termId: task.termId,
        side: task.side,
        distanceM: k.distanceM,
      })),
      database,
    ),
  ]);

  return { count: kept.length, googlePlaceIds: kept.map((k) => k.place.placeId) };
}

/** Re-attach places a cached search already knows about, without calling out. */
async function attachCachedPlaces(ctx: TaskContext, googlePlaceIds: readonly string[]): Promise<number> {
  const { scan, task, database } = ctx;
  if (googlePlaceIds.length === 0) return 0;

  const cached = await readPlaceCache(googlePlaceIds, task.fieldTier as SkuTier, database);

  const attachments = [...cached.values()]
    .map((place) => ({
      scanId: scan.id,
      placeUuid: place.id,
      categoryId: task.categoryId,
      termId: task.termId,
      side: task.side,
      distanceM: haversineDistanceM(scan.centre, place.location),
    }))
    .filter((a) => a.distanceM <= scan.radiusM);

  await attachPlacesToScan(attachments, database);
  return attachments.length;
}

/* -------------------------------------------------------------- finishing */

async function finalise(scanId: string, jobId: string, database: Database): Promise<void> {
  const [rows, saturation, counts] = await Promise.all([
    getScanPlaces(scanId, database),
    getSaturationByTerm(jobId, database),
    countTaskStatuses(jobId, database),
  ]);

  const competition = rows.filter((r) => r.side === "competition");
  const demand = rows.filter((r) => r.side === "demand");
  const rated = competition.filter((r) => typeof r.rating === "number");
  const reviewTotal = competition.reduce((sum, r) => sum + (r.reviewCount ?? 0), 0);

  const saturatedTerms = saturation.filter((s) => s.saturatedTiles > 0);

  await finaliseScan(
    scanId,
    {
      facilityCount: competition.length,
      demandCount: demand.length,
      reviewCount: reviewTotal,
      avgRating: rated.length
        ? rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / rated.length
        : null,
      saturation: {
        anySaturated: saturatedTerms.length > 0,
        terms: saturation,
      },
      stats: {
        distinctPlaces: rows.length,
        categoryCounts: countByCategory(rows),
        failedTasks: counts.failed,
        completedTasks: counts.done,
        totalTasks: counts.total,
      },
    },
    database,
  );
}

function countByCategory(rows: readonly ScanPlaceRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    // A place in two categories counts in both — which is why the result also
    // reports `distinctPlaces` separately, so the two never look contradictory.
    for (const category of row.categories) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
  }
  return counts;
}

function describeProgress(task: ClaimedTask | undefined, done: number, total: number): string {
  if (!task) return `Searching… (${done} of ${total})`;
  return `Searching ${task.termLabel}… (${done} of ${total})`;
}

async function currentCounts(scanId: string, database: Database) {
  const job = await getJobByScanId(scanId, database);
  if (!job) return { done: 0, failed: 0, pending: 0, total: 0, calls: 0, cacheHits: 0, costUsd: 0 };
  const counts = await countTaskStatuses(job.id, database);
  return {
    done: counts.done,
    failed: counts.failed,
    pending: counts.pending,
    total: counts.total,
    calls: job.callCount,
    cacheHits: job.cacheHits,
    costUsd: Number(job.estimatedCostUsd),
  };
}

function emptyResult(scanId: string, status: RunResult["status"]): RunResult {
  return {
    scanId,
    status,
    done: 0,
    failed: 0,
    pending: 0,
    total: 0,
    calls: 0,
    cacheHits: 0,
    costUsd: 0,
    progressLabel: "",
  };
}
