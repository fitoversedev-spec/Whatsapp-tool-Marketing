// Post-won delivery pipeline (spec B7) — backlog, delivery time, booked-vs-
// delivered revenue. Derives entirely from Deal.executionStatus/
// executionStartedAt/deliveryCompletedAt (new nullable fields, unset until
// DealDetailClient.tsx starts writing them) plus the existing wonValue.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { stat, type DurationStat } from "./timelines";

export type ExecutionSummary = {
  backlogValue: number;
  backlogCount: number;
  deliveryTime: DurationStat;
  bookedRevenue: number;
  deliveredRevenue: number;
};

export async function executionSummary(filter: AnalyticsFilter): Promise<ExecutionSummary> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const wonDeals = await prisma.deal.findMany({
    where: { deletedAt: null, outcome: "WON", ...ownerWhere, ...dealChannelWhere },
    select: {
      wonValue: true,
      closedAt: true,
      executionStatus: true,
      executionStartedAt: true,
      deliveryCompletedAt: true,
    },
  });

  let backlogValue = 0;
  let backlogCount = 0;
  let bookedRevenue = 0;
  let deliveredRevenue = 0;
  const deliveryDurationsDays: number[] = [];

  for (const d of wonDeals) {
    const value = d.wonValue ? Number(d.wonValue) : 0;

    if (d.executionStatus === null || d.executionStatus === "IN_EXECUTION") {
      backlogValue += value;
      backlogCount += 1;
    }

    // Booked/delivered revenue are scoped to the filter window (by closedAt,
    // same field products.ts's "won" signal uses) — backlog above is
    // deliberately NOT window-scoped, since it answers "what's outstanding
    // right now", not "what closed in this period".
    if (d.closedAt && d.closedAt >= filter.from && d.closedAt <= filter.to) {
      bookedRevenue += value;
      if (d.deliveryCompletedAt) deliveredRevenue += value;
    }

    if (d.executionStartedAt && d.deliveryCompletedAt) {
      deliveryDurationsDays.push((d.deliveryCompletedAt.getTime() - d.executionStartedAt.getTime()) / 86_400_000);
    }
  }

  return { backlogValue, backlogCount, deliveryTime: stat(deliveryDurationsDays), bookedRevenue, deliveredRevenue };
}
