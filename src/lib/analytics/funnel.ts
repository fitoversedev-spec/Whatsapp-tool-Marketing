// Funnel snapshot (spec §11.3.C) — count + value of deals CURRENTLY sitting
// in each stage, plus a loss-reason breakdown for deals lost in the filter
// window. This is the "what does the pipeline look like right now" view;
// cohort mode ("of deals created in period X, where are they now") is a
// distinct, harder query the spec calls out separately — not built yet,
// noted here rather than silently omitted.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";

export type FunnelStageRow = {
  stageId: string;
  stageName: string;
  stageType: string;
  sortOrder: number;
  count: number;
  value: number;
};

export type LossReasonRow = {
  reasonName: string;
  count: number;
};

export async function funnelSnapshot(
  filter: Pick<AnalyticsFilter, "from" | "to" | "ownerIds">,
): Promise<{ stages: FunnelStageRow[]; lossReasons: LossReasonRow[] }> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};

  const [stages, dealGroups, lostDeals] = await Promise.all([
    prisma.funnelStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.deal.groupBy({
      by: ["currentStageId"],
      where: { deletedAt: null, ...ownerWhere },
      _count: { _all: true },
      _sum: { quotedValue: true, estimatedValue: true, wonValue: true },
    }),
    prisma.deal.findMany({
      where: { outcome: "LOST", closedAt: { gte: filter.from, lte: filter.to }, deletedAt: null, ...ownerWhere },
      select: { lossReason: { select: { name: true } }, lossReasonNote: true },
    }),
  ]);

  const byStage = new Map(dealGroups.map((g) => [g.currentStageId, g]));
  const stageRows: FunnelStageRow[] = stages.map((s) => {
    const g = byStage.get(s.id);
    const value = g ? Number(g._sum.wonValue ?? g._sum.quotedValue ?? g._sum.estimatedValue ?? 0) : 0;
    return { stageId: s.id, stageName: s.name, stageType: s.stageType, sortOrder: s.sortOrder, count: g?._count._all ?? 0, value };
  });

  const lossCounts = new Map<string, number>();
  for (const d of lostDeals) {
    const name = d.lossReason?.name ?? d.lossReasonNote ?? "(no reason given)";
    lossCounts.set(name, (lossCounts.get(name) ?? 0) + 1);
  }
  const lossReasons: LossReasonRow[] = [...lossCounts.entries()]
    .map(([reasonName, count]) => ({ reasonName, count }))
    .sort((a, b) => b.count - a.count);

  return { stages: stageRows, lossReasons };
}
