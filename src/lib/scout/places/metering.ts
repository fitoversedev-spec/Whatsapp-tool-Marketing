/**
 * Cost metering.
 *
 * Every billable Google call is recorded against a user, a scan and a SKU
 * tier, before the money is spent rather than after. That gives three things
 * the project needs:
 *
 * - a **per-user daily cap** that fails with a clear message instead of a
 *   silent stall or a surprise invoice;
 * - the numbers `/api/scout/admin/usage` reports, which Phase 7 renders;
 * - a real measurement of cost per scan, which is currently an estimate from
 *   published list prices (see docs/PHASE-1-UNVERIFIED.md → V4).
 *
 * The SKU tier is never declared by a caller from memory — it is derived from
 * the field mask that was actually sent, so the meter cannot drift from the
 * bill.
 */

import "server-only";

import { Prisma, prisma, type Database } from "@/lib/scout/db";

import { costOfCalls, placesConfig } from "./config";
import type { CallLog } from "./googleClient";

/** UTC calendar day, `YYYY-MM-DD`. The cap resets on this boundary. */
export function usageDate(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export class DailyCapExceededError extends Error {
  constructor(
    readonly used: number,
    readonly cap: number,
  ) {
    super(
      `Daily Google API cap reached: ${used} of ${cap} calls used today. ` +
        `The scan has been stopped rather than continuing to spend. ` +
        `Raise PLACES_DAILY_CALL_CAP or wait for the UTC day to roll over.`,
    );
    this.name = "DailyCapExceededError";
  }
}

export interface RecordCallInput {
  readonly userId: string | null;
  readonly scanId: string | null;
  readonly endpoint: string;
  readonly skuTier: string;
  readonly callCount: number;
  readonly cacheHits?: number;
  readonly latencyMs?: number;
  readonly outcome?: string;
}

/** Record billable calls. Returns the estimated USD they cost. */
export async function recordCalls(
  input: RecordCallInput,
  database: Database = prisma,
): Promise<number> {
  const cost = costOfCalls(input.skuTier, input.callCount);
  await database.apiUsage.create({
    data: {
      userId: input.userId,
      scanId: input.scanId,
      endpoint: input.endpoint,
      skuTier: input.skuTier,
      callCount: input.callCount,
      cacheHits: input.cacheHits ?? 0,
      // `numeric(10,6)` is a `Decimal` to Prisma where it was a string to
      // Drizzle. Still built from `toFixed(6)`, so the rounding is unchanged.
      estimatedCostUsd: new Prisma.Decimal(cost.toFixed(6)),
      latencyMs: input.latencyMs ?? null,
      outcome: input.outcome ?? "ok",
      usageDate: usageDate(),
    },
  });
  return cost;
}

/** Record a cache hit: no call, no cost, but the saving is worth counting. */
export async function recordCacheHit(
  input: Omit<RecordCallInput, "callCount"> & { readonly savedCalls: number },
  database: Database = prisma,
): Promise<void> {
  await database.apiUsage.create({
    data: {
      userId: input.userId,
      scanId: input.scanId,
      endpoint: input.endpoint,
      skuTier: input.skuTier,
      callCount: 0,
      cacheHits: input.savedCalls,
      estimatedCostUsd: new Prisma.Decimal(0),
      latencyMs: input.latencyMs ?? null,
      outcome: "cache",
      usageDate: usageDate(),
    },
  });
}

/** Convenience bridge from the client's structured log to a usage row. */
export function meterFromCallLog(
  log: CallLog,
  context: { userId: string | null; scanId: string | null },
  database: Database = prisma,
): Promise<number> {
  return recordCalls(
    {
      ...context,
      endpoint: log.endpoint,
      skuTier: log.skuTier,
      callCount: log.cacheHit ? 0 : 1,
      cacheHits: log.cacheHit ? 1 : 0,
      latencyMs: log.latencyMs,
      outcome: log.outcome,
    },
    database,
  );
}

export interface DailyUsage {
  readonly calls: number;
  readonly cacheHits: number;
  readonly costUsd: number;
  readonly cap: number;
  readonly remaining: number;
}

export async function getDailyUsage(
  userId: string,
  at: Date = new Date(),
  database: Database = prisma,
): Promise<DailyUsage> {
  /**
   * Raw so the `::int` and `::float8` casts survive. Prisma's `aggregate` would
   * return the cost as a `Decimal` and the sums as `number | null`; the casts
   * are what keep `costUsd` a plain float and the empty case a 0 rather than a
   * null the cap check would then compare against.
   */
  const [row] = await database.$queryRaw<
    Array<{ calls: number; cacheHits: number; costUsd: number }>
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(call_count), 0)::int AS "calls",
      COALESCE(SUM(cache_hits), 0)::int AS "cacheHits",
      COALESCE(SUM(estimated_cost_usd), 0)::float8 AS "costUsd"
    FROM api_usage
    WHERE user_id = ${userId} AND usage_date = ${usageDate(at)}
  `);

  const cap = placesConfig.dailyCallCap;
  const calls = Number(row?.calls ?? 0);
  return {
    calls,
    cacheHits: Number(row?.cacheHits ?? 0),
    costUsd: Number(row?.costUsd ?? 0),
    cap,
    remaining: Math.max(0, cap - calls),
  };
}

/**
 * Throw if `plannedCalls` more calls would take this user past the daily cap.
 *
 * Checked before each worker slice rather than only at scan creation: a scan
 * runs over minutes, and the user may be running a second one alongside it.
 */
export async function assertWithinDailyCap(
  userId: string,
  plannedCalls: number,
  database: Database = prisma,
): Promise<void> {
  const usage = await getDailyUsage(userId, new Date(), database);
  if (usage.calls + plannedCalls > usage.cap) {
    throw new DailyCapExceededError(usage.calls, usage.cap);
  }
}

export interface UsageByUserDay {
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly usageDate: string;
  readonly calls: number;
  readonly cacheHits: number;
  readonly costUsd: number;
}

/**
 * Spend by user and by day, newest first. Backs `/api/scout/admin/usage`; Phase 7
 * builds the screen on top of it.
 */
export async function getUsageByUserAndDay(
  sinceDays = 30,
  database: Database = prisma,
): Promise<UsageByUserDay[]> {
  const since = usageDate(new Date(Date.now() - sinceDays * 86_400_000));

  const rows = await database.$queryRaw<
    Array<{
      userId: string | null;
      usageDate: string;
      calls: number;
      cacheHits: number;
      costUsd: number;
      userEmail: string | null;
    }>
  >(Prisma.sql`
    SELECT
      user_id AS "userId",
      usage_date AS "usageDate",
      SUM(call_count)::int AS "calls",
      SUM(cache_hits)::int AS "cacheHits",
      SUM(estimated_cost_usd)::float8 AS "costUsd",
      (SELECT email FROM users WHERE users.id = api_usage.user_id) AS "userEmail"
    FROM api_usage
    WHERE usage_date >= ${since}
    GROUP BY user_id, usage_date
    ORDER BY usage_date DESC
  `);

  return rows.map((r) => ({
    userId: r.userId,
    userEmail: r.userEmail,
    usageDate: r.usageDate,
    calls: Number(r.calls),
    cacheHits: Number(r.cacheHits),
    costUsd: Number(r.costUsd),
  }));
}

/** Total spend for one scan — the measured cost per scan the handoff wants. */
export async function getScanCost(
  scanId: string,
  database: Database = prisma,
): Promise<{ calls: number; cacheHits: number; costUsd: number }> {
  const [row] = await database.$queryRaw<
    Array<{ calls: number; cacheHits: number; costUsd: number }>
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(call_count), 0)::int AS "calls",
      COALESCE(SUM(cache_hits), 0)::int AS "cacheHits",
      COALESCE(SUM(estimated_cost_usd), 0)::float8 AS "costUsd"
    FROM api_usage
    WHERE scan_id = ${scanId}::uuid
  `);

  return {
    calls: Number(row?.calls ?? 0),
    cacheHits: Number(row?.cacheHits ?? 0),
    costUsd: Number(row?.costUsd ?? 0),
  };
}
