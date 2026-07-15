// Weighted pipeline forecast (spec §11.3.I). Weighted value = Σ(quotedValue
// × stage.probabilityPercent) for open deals with an expectedCloseAt in the
// window. No FunnelStage has a probabilityPercent seeded today (none of the
// 13 spec-supplied stages included one) — the spec is explicit: "never
// fabricate probability defaults", unlike the SLA-hours default elsewhere in
// this build, so this renders the unweighted total with a visible note
// instead of guessing.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";

export type ForecastStageRow = { stageName: string; count: number; value: number; probabilityPercent: number | null };

export type ForecastResult = {
  weightedValue: number | null; // null unless every stage among these deals has a probability configured
  unweightedValue: number;
  dealCount: number;
  probabilitiesConfigured: boolean;
  byStage: ForecastStageRow[];
};

export async function forecast(filter: AnalyticsFilter): Promise<ForecastResult> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};

  const deals = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      outcome: null,
      expectedCloseAt: { gte: filter.from, lte: filter.to },
      ...ownerWhere,
    },
    select: {
      quotedValue: true,
      currentStage: { select: { name: true, probabilityPercent: true } },
    },
  });

  let unweightedValue = 0;
  let weightedValue = 0;
  let allConfigured = true;
  const byStageMap = new Map<string, { count: number; value: number; probabilityPercent: number | null }>();

  for (const d of deals) {
    const value = d.quotedValue ? Number(d.quotedValue) : 0;
    unweightedValue += value;
    const prob = d.currentStage.probabilityPercent;
    if (prob == null) allConfigured = false;
    else weightedValue += value * (prob / 100);

    const e = byStageMap.get(d.currentStage.name) ?? { count: 0, value: 0, probabilityPercent: prob };
    e.count += 1;
    e.value += value;
    byStageMap.set(d.currentStage.name, e);
  }

  return {
    weightedValue: allConfigured && deals.length > 0 ? weightedValue : null,
    unweightedValue,
    dealCount: deals.length,
    probabilitiesConfigured: allConfigured,
    byStage: [...byStageMap.entries()].map(([stageName, v]) => ({ stageName, ...v })).sort((a, b) => b.value - a.value),
  };
}
