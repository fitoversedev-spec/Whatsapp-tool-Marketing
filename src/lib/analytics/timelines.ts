// Timeline + stuck-deal analytics (spec §8.2/§11.3.H). Every duration
// reports median and p90 (not mean — a few stalled deals wreck an average)
// plus n, suppressed to "insufficient data" below MIN_SAMPLE_SIZE.
//
// Early-lifecycle metrics (response time through quotation->negotiation) are
// computed over deals whose enquiryAt falls in the filter window; close-
// anchored metrics (negotiation->close, site visit->close, full cycle) use
// deals whose closedAt falls in the window instead — same creation-vs-close
// cohort split already used in geography.ts/customers.ts/sources.ts.
//
// Full 9-dimension slicing (office/city/tier/profile/business type/product/
// source/value band) from the spec's table is not built here yet — only the
// ownerIds slice already shared by every other screen. That's a real gap,
// not an oversight; worth its own pass once these base numbers are in use.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

// Visible default until Fitoverse supplies real per-stage SLA hours
// (FunnelStage.slaHours) — see docs/DATA_GAPS.md. Same pattern as the
// product low-conversion threshold: a stated default, not an invented fact.
const DEFAULT_SLA_HOURS = 72;

export type DurationStat = { medianDays: number | null; p90Days: number | null; n: number };

export type StuckDeal = {
  dealId: string;
  dealCode: string;
  dealTitle: string;
  stageName: string;
  daysSinceChange: number;
  slaHours: number;
  usingDefaultSla: boolean;
};

export type TimelineMetrics = {
  responseTime: DurationStat;
  enquiryToSiteVisit: DurationStat;
  siteVisitToQuotation: DurationStat;
  quotationToNegotiation: DurationStat;
  negotiationToClose: DurationStat;
  siteVisitToClose: DurationStat;
  fullCycle: DurationStat;
  timeInStage: DurationStat;
  stuckDeals: StuckDeal[];
};

export type StageVelocityRow = { stageId: string; stageName: string; sortOrder: number } & DurationStat;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function stat(values: number[]): DurationStat {
  if (values.length < MIN_SAMPLE_SIZE) return { medianDays: null, p90Days: null, n: values.length };
  const sorted = [...values].sort((a, b) => a - b);
  return { medianDays: percentile(sorted, 0.5), p90Days: percentile(sorted, 0.9), n: values.length };
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

export async function timelineMetrics(filter: AnalyticsFilter): Promise<TimelineMetrics> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};

  // Perf: bounded to deals whose enquiryAt OR closedAt falls in the window —
  // previously unbounded (no date filter at all), re-fetching every non-
  // deleted deal ever created on every call regardless of the selected
  // range (see docs/DECISIONS.md perf note). Below, `deals` only ever feeds
  // earlyCohort (enquiryAt-filtered) and closedCohort (closedAt-filtered),
  // so a row matching neither branch would've contributed to neither cohort
  // anyway — pure narrowing, not a behavior change (verified by diffing
  // full output before/after on live data).
  const deals = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      ...ownerWhere,
      OR: [{ enquiryAt: { gte: filter.from, lte: filter.to } }, { closedAt: { gte: filter.from, lte: filter.to } }],
    },
    select: {
      enquiryAt: true,
      firstContactAt: true,
      siteVisitAt: true,
      firstQuotedAt: true,
      negotiationAt: true,
      closedAt: true,
    },
  });

  const earlyCohort = deals.filter((d) => d.enquiryAt >= filter.from && d.enquiryAt <= filter.to);
  const closedCohort = deals.filter((d) => d.closedAt && d.closedAt >= filter.from && d.closedAt <= filter.to);

  const responseTime = stat(earlyCohort.filter((d) => d.firstContactAt).map((d) => daysBetween(d.enquiryAt, d.firstContactAt!)));
  const enquiryToSiteVisit = stat(earlyCohort.filter((d) => d.siteVisitAt).map((d) => daysBetween(d.enquiryAt, d.siteVisitAt!)));
  const siteVisitToQuotation = stat(
    earlyCohort.filter((d) => d.siteVisitAt && d.firstQuotedAt).map((d) => daysBetween(d.siteVisitAt!, d.firstQuotedAt!)),
  );
  const quotationToNegotiation = stat(
    earlyCohort.filter((d) => d.firstQuotedAt && d.negotiationAt).map((d) => daysBetween(d.firstQuotedAt!, d.negotiationAt!)),
  );

  const negotiationToClose = stat(closedCohort.filter((d) => d.negotiationAt).map((d) => daysBetween(d.negotiationAt!, d.closedAt!)));
  const siteVisitToClose = stat(closedCohort.filter((d) => d.siteVisitAt).map((d) => daysBetween(d.siteVisitAt!, d.closedAt!)));
  const fullCycle = stat(closedCohort.map((d) => daysBetween(d.enquiryAt, d.closedAt!)));

  const historyRows = await prisma.dealStageHistory.findMany({
    where: {
      changedAt: { gte: filter.from, lte: filter.to },
      durationInFromStageSeconds: { not: null },
      ...(filter.ownerIds?.length ? { deal: { ownerUserId: { in: filter.ownerIds } } } : {}),
    },
    select: { durationInFromStageSeconds: true },
  });
  const timeInStage = stat(historyRows.map((h) => h.durationInFromStageSeconds! / 86_400));

  const openDeals = await prisma.deal.findMany({
    where: { deletedAt: null, outcome: null, ...ownerWhere },
    select: {
      id: true,
      code: true,
      title: true,
      enquiryAt: true,
      currentStage: { select: { name: true, slaHours: true } },
      stageHistory: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
    },
  });
  const now = new Date();
  const stuckDeals: StuckDeal[] = openDeals
    .map((d) => {
      const lastChange = d.stageHistory[0]?.changedAt ?? d.enquiryAt;
      const slaHours = d.currentStage.slaHours ?? DEFAULT_SLA_HOURS;
      const hoursSince = (now.getTime() - lastChange.getTime()) / 3_600_000;
      return {
        dealId: d.id,
        dealCode: d.code,
        dealTitle: d.title,
        stageName: d.currentStage.name,
        daysSinceChange: hoursSince / 24,
        slaHours,
        usingDefaultSla: d.currentStage.slaHours == null,
        isStuck: hoursSince > slaHours,
      };
    })
    .filter((d) => d.isStuck)
    .sort((a, b) => b.daysSinceChange - a.daysSinceChange)
    .map(({ isStuck: _isStuck, ...rest }) => rest);

  return {
    responseTime,
    enquiryToSiteVisit,
    siteVisitToQuotation,
    quotationToNegotiation,
    negotiationToClose,
    siteVisitToClose,
    fullCycle,
    timeInStage,
    stuckDeals,
  };
}

// Per-stage breakdown of timeInStage above (which blends every transition
// into one number) — "how long does it take to move from stage X to the
// next one", both overall (no ownerIds) and per rep (ownerIds: [repId]).
// durationInFromStageSeconds is recorded on DealStageHistory.fromStageId,
// i.e. time spent IN that stage before advancing — grouping by fromStageId
// answers exactly that question per real funnel stage, not just the ~6
// fixed milestone timestamps the rest of this file uses.
export async function stageVelocity(filter: AnalyticsFilter): Promise<StageVelocityRow[]> {
  const stages = await prisma.funnelStage.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, sortOrder: true },
  });

  const historyRows = await prisma.dealStageHistory.findMany({
    where: {
      changedAt: { gte: filter.from, lte: filter.to },
      durationInFromStageSeconds: { not: null },
      fromStageId: { not: null },
      ...(filter.ownerIds?.length ? { deal: { ownerUserId: { in: filter.ownerIds } } } : {}),
    },
    select: { fromStageId: true, durationInFromStageSeconds: true },
  });

  const byStage = new Map<string, number[]>();
  for (const h of historyRows) {
    const days = h.durationInFromStageSeconds! / 86_400;
    const arr = byStage.get(h.fromStageId!) ?? [];
    arr.push(days);
    byStage.set(h.fromStageId!, arr);
  }

  return stages.map((s) => ({
    stageId: s.id,
    stageName: s.name,
    sortOrder: s.sortOrder,
    ...stat(byStage.get(s.id) ?? []),
  }));
}
