// Per-stage duration analytics (spec §11.3.H's stageVelocity slice — the
// wider timelineMetrics() this file used to also export, response time
// through stuck-deal detection, was Team Performance-only and removed along
// with that page; see docs/DECISIONS.md). Reports median and p90 (not mean —
// a few stalled deals wreck an average) plus n, suppressed to "insufficient
// data" below MIN_SAMPLE_SIZE.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

export type DurationStat = { medianDays: number | null; p90Days: number | null; n: number };

export type StageVelocityRow = { stageId: string; stageName: string; sortOrder: number } & DurationStat;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

// Exported — cohorts.ts (A7) reuses this exact median/p90/MIN_SAMPLE_SIZE
// gate for its own per-stage and repeat-purchase duration stats rather than
// re-deriving the same logic.
export function stat(values: number[]): DurationStat {
  if (values.length < MIN_SAMPLE_SIZE) return { medianDays: null, p90Days: null, n: values.length };
  const sorted = [...values].sort((a, b) => a - b);
  return { medianDays: percentile(sorted, 0.5), p90Days: percentile(sorted, 0.9), n: values.length };
}

// "How long does it take to move from stage X to the next one", both
// overall (no ownerIds) and per rep (ownerIds: [repId]).
// durationInFromStageSeconds is recorded on DealStageHistory.fromStageId,
// i.e. time spent IN that stage before advancing — grouping by fromStageId
// answers exactly that question per real funnel stage.
export async function stageVelocity(filter: AnalyticsFilter): Promise<StageVelocityRow[]> {
  const stages = await prisma.funnelStage.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, sortOrder: true },
  });

  // Merged into one `deal` key (not two separate conditional spreads) —
  // a second `deal: {...}` object literal would silently clobber the
  // first instead of combining with it. productIds/sportIds/
  // customerProfileIds (A10 "sliceable by X") are mutated onto this same
  // object for the same reason — each is its own `if`, never its own
  // `deal: {...}` literal.
  const dealWhere: Prisma.DealWhereInput = {};
  if (filter.ownerIds?.length) dealWhere.ownerUserId = { in: filter.ownerIds };
  if (filter.dealChannel) dealWhere.dealChannel = filter.dealChannel;
  if (filter.customerProfileIds?.length) dealWhere.account = { customerProfileId: { in: filter.customerProfileIds } };
  if (filter.productIds?.length || filter.sportIds?.length) {
    // Same lineItems.some pattern as dealsDrilldown.ts (Phase 0) — a deal
    // qualifies if ANY of its line items matches the product/sport filter,
    // not that every line item must.
    dealWhere.lineItems = {
      some: {
        ...(filter.productIds?.length ? { productId: { in: filter.productIds } } : {}),
        ...(filter.sportIds?.length ? { sportId: { in: filter.sportIds } } : {}),
      },
    };
  }

  const historyRows = await prisma.dealStageHistory.findMany({
    where: {
      changedAt: { gte: filter.from, lte: filter.to },
      durationInFromStageSeconds: { not: null },
      fromStageId: { not: null },
      ...(Object.keys(dealWhere).length ? { deal: dealWhere } : {}),
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
