// Phase 1 (analytics v2) — Performance→Overview headline numbers (spec
// §11.3 KPI board). Composes salesActivity.ts/benchmarks.ts/targets.ts
// rather than re-querying Prisma directly for anything those already cover;
// this file owns its own owner-scoping via scope.ts so a caller (API route)
// can't leak another rep's numbers by passing a permissive filter.ownerIds.
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "./scope";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import { salesActivity } from "./salesActivity";
import { companyBenchmarks, type Benchmarks } from "./benchmarks";
import { getTargetProgress, type TargetProgress, type TargetScope } from "./targets";
import { repQuadrant } from "./quadrants";

export type RepRankingRow = { ownerId: string; ownerName: string; wonRevenue: number; winRate: number | null; dealsWon: number };

// The non-admin "where you sit" embed (Phase 3, in place of the full
// comparative Rep quadrant scatter admin gets under Quadrants & Territory):
// exactly the caller's own point plus the same benchmark lines, never the
// full points[] array — see selfRepQuadrantPoint below for how that's enforced.
export type RepQuadrantSelf = { x: number; y: number; n: number; xBenchmark: number; yBenchmark: number };

export type KpiBoard = {
  wonRevenue: number;
  targetProgress: TargetProgress | null;
  winRate: { rate: number | null; n: number };
  avgProjectValue: number | null;
  salesVelocity: number | null;
  repRankings: RepRankingRow[] | null;
  benchmarks: Benchmarks;
  repQuadrantSelf: RepQuadrantSelf | null;
  dealsCreated: number; // deals created in-period, same scope as everything else here
};

// Target rows are keyed by an explicit periodType, but this function's
// caller only has a start/end range in hand (the same date-range picker
// every other analytics screen uses) — inferred from the span rather than
// adding a periodType param the plan didn't ask for, matching the "your
// call" precedent targets.ts's own author left for exactly this ambiguity.
function inferPeriodType(start: Date, end: Date): "MONTH" | "QUARTER" | "FY" {
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days <= 31) return "MONTH";
  if (days <= 92) return "QUARTER";
  return "FY";
}

async function openDealCount(filter: AnalyticsFilter): Promise<number> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  return prisma.deal.count({ where: { outcome: null, deletedAt: null, ...ownerWhere, ...dealChannelWhere } });
}

// Zoho-style "Leads this period" headline: count of deals CREATED in the
// window (each deal originates from a contact/lead). filter here is always
// scopedFilter, so ownerIds is already forced to [user.id] for a non-admin —
// this can never count another rep's deals. Same createdAt-windowed + channel
// convention salesActivity.ts uses for its per-owner dealsCreated.
async function createdDealCount(filter: AnalyticsFilter, period: { start: Date; end: Date }): Promise<number> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  return prisma.deal.count({
    where: { createdAt: { gte: period.start, lte: period.end }, deletedAt: null, ...ownerWhere, ...dealChannelWhere },
  });
}

// filter here is always scopedFilter (ownerIds already forced to [userId] for
// a non-admin caller by getKpiBoard below, per scope.ts's own rule) — so
// repQuadrant(filter) only ever computes that one rep's row, never every
// rep's. Extracting the caller's own point from result.points is a belt +
// braces check, not the actual scoping mechanism.
async function selfRepQuadrantPoint(filter: AnalyticsFilter, userId: string): Promise<RepQuadrantSelf | null> {
  const result = await repQuadrant(filter);
  const own = result.points.find((p) => p.id === userId);
  return own ? { x: own.x, y: own.y, n: own.n, xBenchmark: result.xBenchmark, yBenchmark: result.yBenchmark } : null;
}

export async function getKpiBoard(
  user: { id: string; role: Role },
  filter: AnalyticsFilter,
  period: { start: Date; end: Date },
): Promise<KpiBoard> {
  const scope = resolveAnalyticsScope(user);
  // Same merge rule as /api/crm/analytics/performance/route.ts: a
  // caller-supplied ownerIds can only ever narrow an admin's view — for a
  // non-admin, scope.ownerIds (always just [user.id]) wins outright.
  const ownerIds = scope.companyWide ? filter.ownerIds : scope.ownerIds;
  const scopedFilter: AnalyticsFilter = { ...filter, ownerIds };

  // A Target row scoped to exactly the one rep an admin narrowed to is more
  // useful than silently falling back to the company target; any other
  // shape (unfiltered admin, or a hypothetical multi-owner filter) reads as
  // COMPANY, since Target has no multi-user scope to hold that in between.
  const targetScope: TargetScope =
    ownerIds && ownerIds.length === 1 ? { scopeType: "USER", scopeId: ownerIds[0] } : { scopeType: "COMPANY", scopeId: null };
  const targetPeriod = { type: inferPeriodType(period.start, period.end), start: period.start, end: period.end };

  const [activityRows, benchmarks, targetProgress, openDeals, dealsCreated, repQuadrantSelf] = await Promise.all([
    salesActivity(scopedFilter),
    // Always company-wide/crm regardless of the caller's own scope —
    // companyBenchmarks() forces that itself — so a rep's Overview can show
    // "how do I compare" against the same baseline an admin would see.
    companyBenchmarks(filter),
    getTargetProgress(targetScope, targetPeriod, scopedFilter),
    openDealCount(scopedFilter),
    createdDealCount(scopedFilter, period),
    // Admin already gets the full comparative Rep quadrant under Quadrants &
    // Territory — this single-point embed is a non-admin-only concept, so it
    // isn't even computed for scope.companyWide (admin) callers.
    scope.companyWide ? (Promise.resolve(null) as Promise<RepQuadrantSelf | null>) : selfRepQuadrantPoint(scopedFilter, user.id),
  ]);

  let wonRevenue = 0;
  let totalWon = 0;
  let totalClosed = 0;
  let cycleDaysWeighted = 0;
  let cycleN = 0;
  for (const r of activityRows) {
    wonRevenue += r.wonValue;
    totalWon += r.dealsWon;
    totalClosed += r.dealsClosed;
    if (r.avgCycleDays != null) {
      cycleDaysWeighted += r.avgCycleDays * r.dealsClosed;
      cycleN += r.dealsClosed;
    }
  }

  const winRate = totalClosed >= MIN_SAMPLE_SIZE ? totalWon / totalClosed : null;
  const avgProjectValue = totalWon >= MIN_SAMPLE_SIZE ? wonRevenue / totalWon : null;
  const avgCycleDays = cycleN >= MIN_SAMPLE_SIZE ? cycleDaysWeighted / cycleN : null;

  const salesVelocity =
    winRate != null && avgProjectValue != null && avgCycleDays != null && avgCycleDays > 0
      ? (winRate * avgProjectValue * openDeals) / avgCycleDays
      : null;

  const repRankings: RepRankingRow[] | null = scope.companyWide
    ? [...activityRows]
        .map((r) => ({
          ownerId: r.ownerId,
          ownerName: r.ownerName,
          wonRevenue: r.wonValue,
          winRate: r.dealsClosed >= MIN_SAMPLE_SIZE ? r.winRate : null,
          dealsWon: r.dealsWon,
        }))
        .sort((a, b) => b.wonRevenue - a.wonRevenue)
    : null;

  return {
    wonRevenue,
    targetProgress,
    winRate: { rate: winRate, n: totalClosed },
    avgProjectValue,
    salesVelocity,
    repRankings,
    benchmarks,
    repQuadrantSelf,
    dealsCreated,
  };
}
