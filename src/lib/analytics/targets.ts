// Phase 1 (analytics v2) — target vs actual pace/gap engine (spec §11.3 KPI
// board + Targets sub-view). periodType/periodStart are taken as an explicit
// param rather than derived from period.start/end: a caller's date range
// isn't always aligned to a calendar month/quarter/FY boundary, but a Target
// row's identity always is, so deriving it would be guessing.
//
// isPipelineWeighted requires EVERY open deal in this scope's own result set
// to sit in a stage with a probabilityPercent set — not just "some stage
// somewhere has a number". A global/any-stage check would silently zero out
// deals sitting in still-unconfigured stages while still labeling the total
// "weighted", which is a materially misleading number the first time an
// admin fills in probabilityPercent for only some stages (the realistic
// rollout path, not an edge case). Confirmed via a one-off query against the
// real funnel_stages table that all 13 seeded rows currently have
// probabilityPercent null, so this reports "unweighted" today.
import { prisma } from "@/lib/prisma";
import type { Target } from "@prisma/client";
import type { AnalyticsFilter } from "./types";

export type TargetScope = { scopeType: "USER" | "COMPANY"; scopeId: string | null };
export type TargetPeriod = { type: "MONTH" | "QUARTER" | "FY"; start: Date; end: Date };

export type TargetProgress = {
  targetRevenue: number | null; // null if no Target row exists for this scope/period
  targetDeals: number | null;
  wonRevenue: number;
  wonDeals: number;
  paceExpected: number | null; // targetRevenue * (elapsedDays/totalDaysInPeriod), null if no target
  gapToTarget: number | null; // targetRevenue - wonRevenue, null if no target
  openPipelineValue: number; // sum of open deals' quoted/estimated value in scope
  weightedPipelineValue: number | null; // sum(value * probabilityPercent/100), null if isPipelineWeighted is false
  isPipelineWeighted: boolean; // false when probabilityPercent is unset/zero across the board
};

export async function getTargetProgress(
  scope: TargetScope,
  period: TargetPeriod,
  filter: AnalyticsFilter,
): Promise<TargetProgress> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  // Prisma's compound-unique findUnique can't take a null for scopeId
  // (Postgres unique indexes never treat NULL = NULL) — COMPANY scope
  // (scopeId: null) has to go through findFirst instead.
  const [target, closedDeals, openDeals] = await Promise.all([
    scope.scopeId != null
      ? prisma.target.findUnique({
          where: {
            scopeType_scopeId_periodType_periodStart: {
              scopeType: scope.scopeType,
              scopeId: scope.scopeId,
              periodType: period.type,
              periodStart: period.start,
            },
          },
        })
      : prisma.target.findFirst({
          where: { scopeType: scope.scopeType, scopeId: null, periodType: period.type, periodStart: period.start },
        }),
    // Same closed-deal shape as salesActivity.ts: outcome WON, windowed by
    // closedAt (not createdAt) so a burst of new deals doesn't distort it.
    prisma.deal.findMany({
      where: { outcome: "WON", closedAt: { gte: period.start, lte: period.end }, deletedAt: null, ...ownerWhere, ...dealChannelWhere },
      select: { wonValue: true },
    }),
    prisma.deal.findMany({
      where: { outcome: null, deletedAt: null, ...ownerWhere, ...dealChannelWhere },
      select: { quotedValue: true, estimatedValue: true, currentStage: { select: { probabilityPercent: true } } },
    }),
  ]);

  const wonRevenue = closedDeals.reduce((sum, d) => sum + (d.wonValue ? Number(d.wonValue) : 0), 0);
  const wonDeals = closedDeals.length;

  let openPipelineValue = 0;
  let weightedSum = 0;
  let allStagesConfigured = true;
  for (const d of openDeals) {
    // Same fallback chain funnel.ts/staffCommands.ts already use for a deal
    // without a won value: quoted (real) beats estimated (pre-quote guess).
    const value = Number(d.quotedValue ?? d.estimatedValue ?? 0);
    openPipelineValue += value;
    const probability = d.currentStage.probabilityPercent;
    if (probability == null) allStagesConfigured = false;
    weightedSum += value * ((probability ?? 0) / 100);
  }
  const isPipelineWeighted = allStagesConfigured;

  const targetRevenue = target ? Number(target.targetRevenue) : null;
  const targetDeals = target?.targetDeals ?? null;

  const totalDays = Math.max(1, (period.end.getTime() - period.start.getTime()) / 86_400_000);
  const now = new Date();
  const elapsedDays = Math.min(totalDays, Math.max(0, (now.getTime() - period.start.getTime()) / 86_400_000));
  const paceExpected = targetRevenue != null ? targetRevenue * (elapsedDays / totalDays) : null;
  const gapToTarget = targetRevenue != null ? targetRevenue - wonRevenue : null;

  return {
    targetRevenue,
    targetDeals,
    wonRevenue,
    wonDeals,
    paceExpected,
    gapToTarget,
    openPipelineValue,
    weightedPipelineValue: isPipelineWeighted ? weightedSum : null,
    isPipelineWeighted,
  };
}

export async function upsertTarget(input: {
  scopeType: "USER" | "COMPANY";
  scopeId: string | null;
  periodType: "MONTH" | "QUARTER" | "FY";
  periodStart: Date;
  targetRevenue: number;
  targetDeals?: number | null;
  setByUserId: string;
}): Promise<void> {
  const data = { targetRevenue: input.targetRevenue, targetDeals: input.targetDeals ?? null, setByUserId: input.setByUserId };

  // Same nullable-scopeId workaround as getTargetProgress above — upsert's
  // ON CONFLICT can't target a compound unique index through a null column,
  // so COMPANY scope goes through an explicit find-then-write instead.
  if (input.scopeId != null) {
    await prisma.target.upsert({
      where: {
        scopeType_scopeId_periodType_periodStart: {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          periodType: input.periodType,
          periodStart: input.periodStart,
        },
      },
      create: { scopeType: input.scopeType, scopeId: input.scopeId, periodType: input.periodType, periodStart: input.periodStart, ...data },
      update: data,
    });
    return;
  }

  const existing = await prisma.target.findFirst({
    where: { scopeType: input.scopeType, scopeId: null, periodType: input.periodType, periodStart: input.periodStart },
  });
  if (existing) {
    await prisma.target.update({ where: { id: existing.id }, data });
  } else {
    await prisma.target.create({
      data: { scopeType: input.scopeType, scopeId: null, periodType: input.periodType, periodStart: input.periodStart, ...data },
    });
  }
}

// For the admin data-entry screen (Phase 1, built in a later stage) —
// lists every target row so it can render a table with inline edit.
export async function listTargets(scopeType?: "USER" | "COMPANY"): Promise<Target[]> {
  return prisma.target.findMany({
    where: scopeType ? { scopeType } : {},
    orderBy: [{ periodStart: "desc" }],
  });
}
