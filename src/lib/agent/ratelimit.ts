import { prisma } from "@/lib/prisma";
import { after } from "@/lib/scout/after";
import { toolGroup } from "./permissions";

/**
 * Fixed-window rate limiting in Postgres, one atomic statement per counter.
 *
 * Each call increments a minute counter and an hour counter for the identity,
 * plus the same pair for the tool's group when the group has its own limit.
 * The increment is a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so
 * there is no read-then-write race and no interactive transaction (PgBouncer in
 * transaction mode is fine with it).
 *
 * Limits: Setting row `agent_rate_limits` (JSON) merged over the code defaults:
 *   { "perMinute": 60, "perHour": 1000,
 *     "groups": { "send": { "perMinute": 10, "perHour": 100 } } }
 */
export type Limit = { perMinute: number; perHour: number };
export type RateLimits = Limit & { groups: Record<string, Limit> };

export const DEFAULT_RATE_LIMITS: RateLimits = { perMinute: 60, perHour: 1000, groups: {} };

const SETTING_KEY = "agent_rate_limits";
const MAX_LIMIT = 1_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function posInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_LIMIT ? v : null;
}

/** Pure: merge a stored JSON value over the defaults; anything invalid is ignored. */
export function resolveLimits(stored: unknown): RateLimits {
  const out: RateLimits = {
    perMinute: DEFAULT_RATE_LIMITS.perMinute,
    perHour: DEFAULT_RATE_LIMITS.perHour,
    groups: {},
  };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  const s = stored as Record<string, unknown>;
  out.perMinute = posInt(s.perMinute) ?? out.perMinute;
  out.perHour = posInt(s.perHour) ?? out.perHour;
  if (s.groups && typeof s.groups === "object" && !Array.isArray(s.groups)) {
    for (const [name, g] of Object.entries(s.groups as Record<string, unknown>)) {
      if (!/^[a-z_]{1,32}$/.test(name) || !g || typeof g !== "object") continue;
      const pm = posInt((g as Record<string, unknown>).perMinute);
      const ph = posInt((g as Record<string, unknown>).perHour);
      if (pm || ph) out.groups[name] = { perMinute: pm ?? out.perMinute, perHour: ph ?? out.perHour };
    }
  }
  return out;
}

export function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

export function secondsUntilNextWindow(now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000));
}

let limitsCache: { at: number; value: RateLimits } | null = null;

export async function getRateLimits(): Promise<RateLimits> {
  if (limitsCache && Date.now() - limitsCache.at < 15_000) return limitsCache.value;
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  let stored: unknown = null;
  try {
    stored = row?.value ? JSON.parse(row.value) : null;
  } catch {
    stored = null;
  }
  const value = resolveLimits(stored);
  limitsCache = { at: Date.now(), value };
  return value;
}

export function resetRateLimitCache(): void {
  limitsCache = null;
}

/** One atomic increment. Returns the counter value AFTER this request. */
export async function incrementBucket(identityId: string, scope: string, start: Date): Promise<number> {
  const iso = start.toISOString();
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO agent_rate_buckets (identity_id, scope, window_start, count)
    VALUES (${identityId}, ${scope}, ${iso}::timestamp, 1)
    ON CONFLICT (identity_id, scope, window_start)
    DO UPDATE SET count = agent_rate_buckets.count + 1
    RETURNING count`;
  return Number(rows[0]?.count ?? 0);
}

export type RateDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number; scope: string; limit: number };

/**
 * Charge one request against the identity (and tool-group) limits.
 * Minute windows are checked before hour windows so a burst that trips the
 * minute limit doesn't also burn the hour budget.
 */
export async function checkRateLimit(identityId: string, tool: string, now = Date.now()): Promise<RateDecision> {
  const limits = await getRateLimits();
  const group = toolGroup(tool);
  const checks: { scope: string; windowMs: number; limit: number }[] = [
    { scope: "m:all", windowMs: MINUTE_MS, limit: limits.perMinute },
  ];
  const g = limits.groups[group];
  if (g) checks.push({ scope: `m:grp:${group}`, windowMs: MINUTE_MS, limit: g.perMinute });
  checks.push({ scope: "h:all", windowMs: HOUR_MS, limit: limits.perHour });
  if (g) checks.push({ scope: `h:grp:${group}`, windowMs: HOUR_MS, limit: g.perHour });

  for (const c of checks) {
    const count = await incrementBucket(identityId, c.scope, windowStart(now, c.windowMs));
    if (count > c.limit) {
      return {
        allowed: false,
        retryAfterSec: secondsUntilNextWindow(now, c.windowMs),
        scope: c.scope,
        limit: c.limit,
      };
    }
  }

  // Housekeeping: now and then, drop counters from finished windows.
  if (Math.random() < 0.005) {
    after(() => prisma.$executeRaw`DELETE FROM agent_rate_buckets WHERE window_start < now() - interval '3 hours'`);
  }
  return { allowed: true };
}
