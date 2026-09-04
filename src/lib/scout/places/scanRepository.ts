/**
 * Database operations for the scan job.
 *
 * Kept separate from the orchestration in `scanPipeline.ts` so the interesting
 * logic there is readable, and so the two concurrency-sensitive operations —
 * leasing a job and claiming a task — sit next to each other where they can be
 * reasoned about together.
 *
 * Both use a single atomic `UPDATE … WHERE` with the guard in the predicate.
 * Read-then-write would let two workers claim the same task, which on a
 * billable API means paying twice for the same tile.
 *
 * ## Why so much of this file is raw SQL
 *
 * `scans.centre` and `scan_job_tasks.tile_centre` are `geography(Point,4326)`,
 * which Prisma models as `Unsupported`. Prisma Client **cannot insert a row
 * into a table with a required `Unsupported` column at all** — the column is
 * simply absent from the generated `create` input, and the insert fails on the
 * NOT NULL. So every write that creates a scan or a task is raw, not only the
 * spatial predicates. Reads that need the point back are raw for the same
 * reason: an `Unsupported` column cannot appear in a `select`, so the
 * coordinates have to be projected with `ST_X` / `ST_Y`.
 *
 * Two more are raw by choice rather than necessity, and say so where they are.
 */

import "server-only";

import { Prisma, prisma, type Database, type DatabaseClient } from "@/lib/scout/db";
import type { LatLng } from "@/lib/scout/geo/distance";
import type { Tile } from "@/lib/scout/geo/tiling";

import { placesConfig } from "./config";
import type { ResolvedTerm } from "./taxonomy";

/** A `geography(Point,4326)` literal from a lat/lng pair. */
function pointSql(p: LatLng) {
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng}::double precision, ${p.lat}::double precision), 4326)::geography`;
}

export interface CreateScanInput {
  readonly ownerId: string;
  readonly siteId?: string | null;
  readonly areaLabel: string;
  readonly customerName?: string | null;
  readonly address?: string | null;
  readonly centre: LatLng;
  readonly radiusM: number;
  readonly categoryIds: readonly string[];
  readonly tileRadiusM: number;
  readonly tileOverlap: number;
}

export interface CreatedScan {
  readonly scanId: string;
  readonly jobId: string;
  readonly totalTasks: number;
  readonly tileCount: number;
}

/**
 * Create the scan, its job and every unit of work, in one transaction.
 *
 * The whole plan is written up front rather than derived as the worker goes.
 * That is what makes a resume exact: the tiles a scan is *supposed* to cover
 * are rows in the database, not a computation someone hopes is deterministic.
 */
export async function createScanWithJob(
  input: CreateScanInput,
  tiles: readonly Tile[],
  terms: readonly ResolvedTerm[],
  database: DatabaseClient = prisma,
): Promise<CreatedScan> {
  return database.$transaction(async (tx) => {
    const searchTerms = {
      categoryIds: [...input.categoryIds],
      termIds: terms.map((t) => t.term.id),
      tileRadiusM: input.tileRadiusM,
      tileOverlap: input.tileOverlap,
    };

    // Raw: `centre` is a required geography column, which Prisma Client cannot
    // supply through `scan.create`.
    const [scan] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO scans (owner_id, site_id, area_label, customer_name, address,
                         centre, radius_m, search_terms, status)
      VALUES (${input.ownerId}, ${input.siteId ?? null}::uuid, ${input.areaLabel},
              ${input.customerName ?? null}, ${input.address ?? null},
              ${pointSql(input.centre)}, ${Math.round(input.radiusM)},
              ${JSON.stringify(searchTerms)}::jsonb, 'draft'::scan_status)
      RETURNING id
    `);

    if (!scan) throw new Error("createScanWithJob: the scan insert returned no row");

    const totalTasks = tiles.length * terms.length;

    const job = await tx.scanJob.create({
      data: {
        scanId: scan.id,
        status: "queued",
        totalTasks,
        tileCount: tiles.length,
        progressLabel: totalTasks === 0 ? "Nothing to search" : "Queued",
      },
      select: { id: true },
    });

    if (totalTasks > 0) {
      const rows = tiles.flatMap((tile) =>
        terms.map(
          (resolved) => Prisma.sql`(
            ${job.id}::uuid, ${tile.index}, ${pointSql(tile.centre)},
            ${Math.round(tile.radiusM)}, ${resolved.categoryId}, ${resolved.term.id},
            ${resolved.term.label}, ${resolved.side}::place_side, ${resolved.term.mode},
            ${resolved.fields}
          )`,
        ),
      );
      // Chunked: a 5 km full sweep is ~90 tiles × 33 terms ≈ 3 000 rows, and a
      // single INSERT with that many parameter sets exceeds the driver's limit.
      for (let i = 0; i < rows.length; i += 500) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO scan_job_tasks
            (job_id, tile_index, tile_centre, tile_radius_m, category_id,
             term_id, term_label, side, mode, field_tier)
          VALUES ${Prisma.join(rows.slice(i, i + 500), ", ")}
        `);
      }
    }

    return { scanId: scan.id, jobId: job.id, totalTasks, tileCount: tiles.length };
  });
}

export interface JobLease {
  readonly jobId: string;
  readonly scanId: string;
  readonly leaseToken: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
}

/**
 * Take exclusive ownership of a job for `jobLeaseMs`.
 *
 * Returns `null` when another worker already holds a live lease — that is the
 * normal answer when the client polls while a worker is mid-slice, not an
 * error. An expired lease is reclaimable, which is what stops a worker killed
 * mid-tile from stranding the scan forever.
 *
 * Raw because of `COALESCE(started_at, $now)`: the first claim stamps
 * `started_at`, a reclaim after an expired lease must leave it alone, and
 * Prisma's `update` has no way to write a value derived from the current one.
 */
export async function claimJob(
  scanId: string,
  database: Database = prisma,
): Promise<JobLease | null> {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + placesConfig.jobLeaseMs);

  const [row] = await database.$queryRaw<
    Array<{ jobId: string; scanId: string; totalTasks: number; completedTasks: number }>
  >(Prisma.sql`
    UPDATE scan_jobs
    SET status = 'running'::scan_job_status,
        lease_token = ${token}::uuid,
        lease_expires_at = ${expiresAt},
        started_at = COALESCE(started_at, ${now}),
        updated_at = ${now}
    WHERE scan_id = ${scanId}::uuid
      AND status IN ('queued','running','paused')
      AND (lease_expires_at IS NULL OR lease_expires_at < ${now})
    RETURNING id AS "jobId", scan_id AS "scanId",
              total_tasks AS "totalTasks", completed_tasks AS "completedTasks"
  `);

  return row ? { ...row, leaseToken: token } : null;
}

/** Extend a held lease. Called between slices so a long scan keeps its claim. */
export async function renewLease(lease: JobLease, database: Database = prisma): Promise<boolean> {
  const expiresAt = new Date(Date.now() + placesConfig.jobLeaseMs);
  const { count } = await database.scanJob.updateMany({
    where: { id: lease.jobId, leaseToken: lease.leaseToken },
    data: { leaseExpiresAt: expiresAt, updatedAt: new Date() },
  });
  return count > 0;
}

/**
 * Hand the job back.
 *
 * `paused` rather than `queued`: the distinction tells the progress endpoint
 * that work has genuinely started, so the UI can show a resume affordance
 * instead of "queued" on a scan that is 80 % done.
 */
export async function releaseJob(
  lease: JobLease,
  status: "paused" | "completed" | "failed",
  extra: { lastError?: string | null } = {},
  database: Database = prisma,
): Promise<void> {
  await database.scanJob.updateMany({
    where: { id: lease.jobId, leaseToken: lease.leaseToken },
    data: {
      status,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: extra.lastError ?? null,
      finishedAt: status === "paused" ? null : new Date(),
      updatedAt: new Date(),
    },
  });
}

export interface ClaimedTask {
  readonly id: string;
  readonly tileIndex: number;
  readonly tileCentre: LatLng;
  readonly tileRadiusM: number;
  readonly categoryId: string;
  readonly termId: string;
  readonly termLabel: string;
  readonly side: "competition" | "demand";
  readonly mode: string;
  readonly fieldTier: string;
  readonly attempts: number;
}

/**
 * Claim up to `limit` pending tasks, in plan order, marking them `running` in
 * the same statement that selects them.
 *
 * `FOR UPDATE SKIP LOCKED` inside the sub-select is what makes two concurrent
 * workers cooperate rather than collide: the second one skips the rows the
 * first has locked and takes the next ones.
 */
export async function claimTasks(
  jobId: string,
  limit: number,
  database: Database = prisma,
): Promise<ClaimedTask[]> {
  const maxAttempts = placesConfig.taskMaxAttempts;

  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    UPDATE scan_job_tasks AS t
    SET status = 'running', attempts = t.attempts + 1
    WHERE t.id IN (
      SELECT id FROM scan_job_tasks
      WHERE job_id = ${jobId}::uuid
        AND status = 'pending'
        AND attempts < ${maxAttempts}
      ORDER BY tile_index ASC, term_id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      t.id,
      t.tile_index,
      ST_Y(t.tile_centre::geometry) AS lat,
      ST_X(t.tile_centre::geometry) AS lng,
      t.tile_radius_m,
      t.category_id,
      t.term_id,
      t.term_label,
      t.side::text AS side,
      t.mode,
      t.field_tier,
      t.attempts
  `);

  return rows.map((r) => ({
    id: String(r.id),
    tileIndex: Number(r.tile_index),
    tileCentre: { lat: Number(r.lat), lng: Number(r.lng) },
    tileRadiusM: Number(r.tile_radius_m),
    categoryId: String(r.category_id),
    termId: String(r.term_id),
    termLabel: String(r.term_label),
    side: String(r.side) as "competition" | "demand",
    mode: String(r.mode),
    fieldTier: String(r.field_tier),
    attempts: Number(r.attempts),
  }));
}

/**
 * Put a `running` task back to `pending`.
 *
 * Called when a worker slice is abandoned mid-flight — the process was killed,
 * the budget ran out between claim and execution, or the lease was lost. The
 * attempt counter is not rewound, so a task that keeps dying still exhausts
 * its retries rather than looping forever.
 */
export async function releaseRunningTasks(
  jobId: string,
  database: Database = prisma,
): Promise<number> {
  const { count } = await database.scanJobTask.updateMany({
    where: { jobId, status: "running" },
    data: { status: "pending" },
  });
  return count;
}

export async function completeTask(
  taskId: string,
  outcome: { resultCount: number; saturated: boolean; callCount: number },
  database: Database = prisma,
): Promise<void> {
  await database.scanJobTask.updateMany({
    where: { id: taskId },
    data: {
      status: "done",
      resultCount: outcome.resultCount,
      saturated: outcome.saturated,
      callCount: outcome.callCount,
      completedAt: new Date(),
      lastError: null,
    },
  });
}

/**
 * Record a failed attempt.
 *
 * Below the attempt ceiling the task goes back to `pending` and will be
 * retried on a later slice. At the ceiling it is marked `failed` and the scan
 * continues without it — one dead search term must not sink a scan that has
 * already paid for sixty other tiles. The failure is surfaced in the result.
 */
export async function failTask(
  taskId: string,
  error: string,
  attempts: number,
  database: Database = prisma,
): Promise<"retry" | "failed"> {
  const exhausted = attempts >= placesConfig.taskMaxAttempts;
  await database.scanJobTask.updateMany({
    where: { id: taskId },
    data: {
      status: exhausted ? "failed" : "pending",
      lastError: error.slice(0, 2_000),
      completedAt: exhausted ? new Date() : null,
    },
  });
  return exhausted ? "failed" : "retry";
}

export interface JobProgressCounts {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly pending: number;
}

/**
 * All four counts in one round trip.
 *
 * Raw for the `FILTER` aggregates. Prisma's `groupBy` would return one row per
 * status and cost the same, but then the caller has to reassemble the four
 * numbers and handle the statuses that produced no rows — and the reassembly is
 * where a missing zero turns into a progress bar that never reaches the end.
 */
export async function countTaskStatuses(
  jobId: string,
  database: Database = prisma,
): Promise<JobProgressCounts> {
  const [row] = await database.$queryRaw<
    Array<{ total: number; done: number; failed: number; pending: number }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'done')::int AS done,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status IN ('pending','running'))::int AS pending
    FROM scan_job_tasks
    WHERE job_id = ${jobId}::uuid
  `);

  return {
    total: Number(row?.total ?? 0),
    done: Number(row?.done ?? 0),
    failed: Number(row?.failed ?? 0),
    pending: Number(row?.pending ?? 0),
  };
}

export async function updateJobProgress(
  jobId: string,
  patch: {
    completedTasks?: number;
    failedTasks?: number;
    progressLabel?: string;
    callsDelta?: number;
    cacheHitsDelta?: number;
    costDelta?: number;
  },
  database: Database = prisma,
): Promise<void> {
  await database.scanJob.updateMany({
    where: { id: jobId },
    data: {
      ...(patch.completedTasks !== undefined ? { completedTasks: patch.completedTasks } : {}),
      ...(patch.failedTasks !== undefined ? { failedTasks: patch.failedTasks } : {}),
      ...(patch.progressLabel !== undefined ? { progressLabel: patch.progressLabel } : {}),
      // `increment` is `column = column + n` in the SQL, so two workers
      // reporting at once still add up — the same guarantee the Drizzle
      // `sql\`call_count + n\`` gave.
      ...(patch.callsDelta ? { callCount: { increment: patch.callsDelta } } : {}),
      ...(patch.cacheHitsDelta ? { cacheHits: { increment: patch.cacheHitsDelta } } : {}),
      ...(patch.costDelta
        ? { estimatedCostUsd: { increment: new Prisma.Decimal(patch.costDelta.toFixed(4)) } }
        : {}),
      updatedAt: new Date(),
    },
  });
}

export interface AttachPlaceInput {
  readonly scanId: string;
  readonly placeUuid: string;
  readonly categoryId: string;
  readonly termId: string;
  readonly side: "competition" | "demand";
  readonly distanceM: number;
}

/**
 * Attach a place to a scan, **accumulating** categories rather than replacing
 * them.
 *
 * This is the fix for v16's first-term-wins bug. v16 kept one global `seen`
 * set across all search terms, so a venue that is both a football turf and
 * cricket nets was claimed by whichever term happened to be typed first, and
 * category counts changed with term order. Here the place is deduped globally
 * by `place_id` but its `categories` array grows.
 *
 * `side` resolves to `competition` when any competition term matched: a venue
 * that is real supply must count as supply even if a demand term also found it.
 */
export async function attachPlacesToScan(
  inputs: readonly AttachPlaceInput[],
  database: Database = prisma,
): Promise<void> {
  if (inputs.length === 0) return;

  // One row per place: Postgres rejects an ON CONFLICT DO UPDATE that would
  // affect the same row twice in a single statement, and a term's several
  // query strings can each surface the same venue.
  const unique = new Map<string, AttachPlaceInput>();
  for (const input of inputs) {
    const existing = unique.get(input.placeUuid);
    if (!existing || input.distanceM < existing.distanceM) unique.set(input.placeUuid, input);
  }

  const values = [...unique.values()].map(
    (input) => Prisma.sql`(
      ${input.scanId}::uuid, ${input.placeUuid}::uuid,
      ARRAY[${input.categoryId}]::text[], ARRAY[${input.termId}]::text[],
      ${input.side}::place_side, ${input.distanceM}::double precision
    )`,
  );

  await database.$executeRaw(Prisma.sql`
    INSERT INTO scan_places (scan_id, place_id, categories, matched_terms, side, distance_m)
    VALUES ${Prisma.join(values, ", ")}
    ON CONFLICT (scan_id, place_id) DO UPDATE SET
      categories = (
        SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), ARRAY[]::text[])
        FROM unnest(scan_places.categories || excluded.categories) AS c
      ),
      matched_terms = (
        SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), ARRAY[]::text[])
        FROM unnest(scan_places.matched_terms || excluded.matched_terms) AS t
      ),
      side = CASE
        WHEN scan_places.side = 'competition' OR excluded.side = 'competition'
        THEN 'competition'::place_side
        ELSE scan_places.side
      END,
      distance_m = LEAST(scan_places.distance_m, excluded.distance_m)
  `);
}

/* ------------------------------------------------------------- read side */

export interface ScanRow {
  readonly id: string;
  readonly ownerId: string;
  readonly areaLabel: string;
  readonly centre: LatLng;
  readonly radiusM: number;
  readonly status: string;
  readonly searchTerms: Record<string, unknown>;
}

/** Raw: `centre` is `Unsupported`, so the point has to be projected out. */
export async function getScan(
  scanId: string,
  database: Database = prisma,
): Promise<ScanRow | null> {
  const [row] = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT id, owner_id, area_label, radius_m, status::text AS status, search_terms,
           ST_Y(centre::geometry) AS lat,
           ST_X(centre::geometry) AS lng
    FROM scans
    WHERE id = ${scanId}::uuid
    LIMIT 1
  `);

  if (!row) return null;
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    areaLabel: String(row.area_label),
    centre: { lat: Number(row.lat), lng: Number(row.lng) },
    radiusM: Number(row.radius_m),
    status: String(row.status),
    searchTerms: (row.search_terms ?? {}) as Record<string, unknown>,
  };
}

export async function getJobByScanId(scanId: string, database: Database = prisma) {
  return database.scanJob.findUnique({ where: { scanId } });
}

/** Per-term saturation, so the UI can say "at least N schools" honestly. */
export async function getSaturationByTerm(
  jobId: string,
  database: Database = prisma,
): Promise<Array<{ termId: string; termLabel: string; saturatedTiles: number; totalTiles: number }>> {
  const rows = await database.$queryRaw<
    Array<{ termId: string; termLabel: string; saturatedTiles: number; totalTiles: number }>
  >(Prisma.sql`
    SELECT term_id AS "termId",
           term_label AS "termLabel",
           COUNT(*) FILTER (WHERE saturated)::int AS "saturatedTiles",
           COUNT(*)::int AS "totalTiles"
    FROM scan_job_tasks
    WHERE job_id = ${jobId}::uuid
    GROUP BY term_id, term_label
    ORDER BY term_id ASC
  `);

  return rows.map((r) => ({
    termId: r.termId,
    termLabel: r.termLabel,
    saturatedTiles: Number(r.saturatedTiles),
    totalTiles: Number(r.totalTiles),
  }));
}

export interface ScanPlaceRow {
  readonly placeId: string;
  readonly name: string;
  readonly location: LatLng;
  readonly distanceM: number;
  readonly categories: string[];
  readonly matchedTerms: string[];
  readonly side: "competition" | "demand";
  readonly rating: number | null;
  readonly reviewCount: number | null;
  readonly address: string | null;
  readonly priceLevel: number | null;
  readonly website: string | null;
  readonly phone: string | null;
  readonly primaryType: string | null;
  readonly primaryTypeDisplayName: string | null;
  readonly businessStatus: string | null;
  readonly googleMapsUri: string | null;
  readonly operatingWindow: Record<string, unknown> | null;
  readonly reviewsStored: number;
}

/** Raw: `places.location` is `Unsupported`, so lat/lng are projected out. */
export async function getScanPlaces(
  scanId: string,
  database: Database = prisma,
): Promise<ScanPlaceRow[]> {
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      p.place_id, p.name, sp.distance_m, sp.categories, sp.matched_terms,
      sp.side::text AS side, p.rating, p.review_count, p.address, p.price_level,
      p.website, p.phone, p.primary_type, p.primary_type_display_name,
      p.business_status, p.google_maps_uri, p.operating_window,
      ST_Y(p.location::geometry) AS lat,
      ST_X(p.location::geometry) AS lng,
      (SELECT COUNT(*) FROM place_reviews pr WHERE pr.place_id = p.id)::int AS reviews_stored
    FROM scan_places sp
    INNER JOIN places p ON p.id = sp.place_id
    WHERE sp.scan_id = ${scanId}::uuid
    ORDER BY sp.distance_m ASC
  `);

  return rows.map((r) => ({
    placeId: String(r.place_id),
    name: String(r.name),
    location: { lat: Number(r.lat), lng: Number(r.lng) },
    distanceM: Number(r.distance_m ?? 0),
    categories: (r.categories ?? []) as string[],
    matchedTerms: (r.matched_terms ?? []) as string[],
    side: String(r.side) as "competition" | "demand",
    rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
    reviewCount: r.review_count === null || r.review_count === undefined ? null : Number(r.review_count),
    address: (r.address as string | null) ?? null,
    priceLevel: r.price_level === null || r.price_level === undefined ? null : Number(r.price_level),
    website: (r.website as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    primaryType: (r.primary_type as string | null) ?? null,
    primaryTypeDisplayName: (r.primary_type_display_name as string | null) ?? null,
    businessStatus: (r.business_status as string | null) ?? null,
    googleMapsUri: (r.google_maps_uri as string | null) ?? null,
    operatingWindow: (r.operating_window as Record<string, unknown> | null) ?? null,
    reviewsStored: Number(r.reviews_stored),
  }));
}

export async function finaliseScan(
  scanId: string,
  summary: {
    facilityCount: number;
    demandCount: number;
    reviewCount: number;
    avgRating: number | null;
    saturation: Record<string, unknown>;
    stats: Record<string, unknown>;
  },
  database: Database = prisma,
): Promise<void> {
  await database.scan.updateMany({
    where: { id: scanId },
    data: {
      status: "scanned",
      facilityCount: summary.facilityCount,
      demandCount: summary.demandCount,
      reviewCount: summary.reviewCount,
      avgRating: summary.avgRating,
      saturation: summary.saturation as Prisma.InputJsonValue,
      stats: summary.stats as Prisma.InputJsonValue,
      scannedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/** Reviews for a place, used by the handoff's worked example and by Phase 3. */
export async function getReviewsForPlace(placeUuid: string, database: Database = prisma) {
  return database.placeReview.findMany({ where: { placeId: placeUuid } });
}
