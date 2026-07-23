// Phase 2 (analytics v2) — Comparisons & Patterns group (A7). "Of what we
// got in creation-month M, how much closed and how fast" (enquiryCohort) and
// "how long until a repeat customer's next purchase" (repeatPurchaseCohort).
// Seasonal cohort (B1, Phase 4) reuses this file's cohort index rather than
// duplicating it — not built here, noted rather than silently omitted, same
// as funnel.ts flags its own deferred cohort-mode work.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import { stat, type DurationStat } from "./timelines";

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type CohortStageCell = {
  stageId: string; // "WON" for the synthetic bucket, a real FunnelStage.id otherwise
  stageName: string;
  sortOrder: number;
  reachedCount: number;
  reachedPct: number | null; // reachedCount / cohortSize, null when the whole row is insufficientData
  medianDaysToReach: number | null;
  p90DaysToReach: number | null;
};

export type EnquiryCohortRow = {
  month: string; // "YYYY-MM", keyed on enquiryAt
  cohortSize: number;
  insufficientData: boolean; // cohortSize < MIN_SAMPLE_SIZE — rates/timings above are suppressed, not the row
  stages: CohortStageCell[];
};

// "Active FunnelStage" here means stageType==="active" specifically (the
// codebase's own vocabulary, per FunnelStage.stageType's schema comment) —
// deliberately excludes stageType==="lost" rows (Lost/Dropped). Those are
// exits, not further progress: their sortOrder (11, 12) sits numerically
// past Won's (10), so treating them as part of the same "reached X or
// further" ladder would make a deal that got marked Lost straight out of
// Site Visit look like it had also "reached" Quotation/Negotiation, which
// it never did. The synthetic WON bucket below is the one terminal outcome
// that legitimately belongs on this ladder.
export async function enquiryCohort(filter: AnalyticsFilter): Promise<EnquiryCohortRow[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const [activeStages, wonStage, deals] = await Promise.all([
    prisma.funnelStage.findMany({
      where: { isActive: true, stageType: "active" },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, sortOrder: true },
    }),
    prisma.funnelStage.findFirst({
      where: { isActive: true, stageType: "won" },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, sortOrder: true },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, enquiryAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { id: true, enquiryAt: true, outcome: true, closedAt: true },
    }),
  ]);

  if (!activeStages.length) return [];

  const dealIds = deals.map((d) => d.id);
  // Only toStage transitions that aren't a Lost/Dropped exit qualify as
  // "progress" — see the function-level comment above. A deal that never
  // moved at all still starts credited with the lowest-sortOrder active
  // stage at enquiryAt (defaultFunnelStageId's own invariant — every Deal is
  // created there), so no history row is needed to cover that base case.
  const historyRows = dealIds.length
    ? await prisma.dealStageHistory.findMany({
        where: { dealId: { in: dealIds }, toStage: { stageType: { not: "lost" } } },
        select: { dealId: true, changedAt: true, toStage: { select: { sortOrder: true } } },
      })
    : [];

  const eventsByDeal = new Map<string, { sortOrder: number; at: Date }[]>();
  const baseSortOrder = activeStages[0].sortOrder;
  for (const d of deals) {
    eventsByDeal.set(d.id, [{ sortOrder: baseSortOrder, at: d.enquiryAt }]);
  }
  for (const h of historyRows) {
    const arr = eventsByDeal.get(h.dealId);
    if (!arr) continue;
    arr.push({ sortOrder: h.toStage.sortOrder, at: h.changedAt });
  }

  const dealsByMonth = new Map<string, typeof deals>();
  for (const d of deals) {
    const key = monthKey(d.enquiryAt);
    const arr = dealsByMonth.get(key) ?? [];
    arr.push(d);
    dealsByMonth.set(key, arr);
  }

  const wonBucketSortOrder = wonStage?.sortOrder ?? activeStages[activeStages.length - 1].sortOrder + 1;
  const wonBucketName = wonStage?.name ?? "Won";

  const rows: EnquiryCohortRow[] = [...dealsByMonth.entries()]
    .map(([month, monthDeals]) => {
      const cohortSize = monthDeals.length;
      const insufficientData = cohortSize < MIN_SAMPLE_SIZE;

      const stageCells: CohortStageCell[] = activeStages.map((s) => {
        const daysToReach: number[] = [];
        let reachedCount = 0;
        for (const d of monthDeals) {
          const events = eventsByDeal.get(d.id) ?? [];
          const reachTimes = events.filter((e) => e.sortOrder >= s.sortOrder).map((e) => e.at.getTime());
          if (!reachTimes.length) continue;
          reachedCount += 1;
          const firstReachedAt = Math.min(...reachTimes);
          daysToReach.push((firstReachedAt - d.enquiryAt.getTime()) / 86_400_000);
        }
        const durationStat = stat(daysToReach);
        return {
          stageId: s.id,
          stageName: s.name,
          sortOrder: s.sortOrder,
          reachedCount,
          reachedPct: insufficientData ? null : reachedCount / cohortSize,
          medianDaysToReach: durationStat.medianDays,
          p90DaysToReach: durationStat.p90Days,
        };
      });

      const wonDaysToClose: number[] = [];
      let wonCount = 0;
      for (const d of monthDeals) {
        if (d.outcome !== "WON") continue;
        wonCount += 1;
        if (d.closedAt) wonDaysToClose.push((d.closedAt.getTime() - d.enquiryAt.getTime()) / 86_400_000);
      }
      const wonStat = stat(wonDaysToClose);
      const wonCell: CohortStageCell = {
        stageId: "WON",
        stageName: wonBucketName,
        sortOrder: wonBucketSortOrder,
        reachedCount: wonCount,
        reachedPct: insufficientData ? null : wonCount / cohortSize,
        medianDaysToReach: wonStat.medianDays,
        p90DaysToReach: wonStat.p90Days,
      };

      return { month, cohortSize, insufficientData, stages: [...stageCells, wonCell] };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  return rows;
}

export type RepeatPurchaseRow = { pairIndex: number; label: string } & DurationStat;

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

// Grouped on Account (not on Deal.leadSourceId's "Existing Customer —
// Repeat" source, which is rep-entered at creation time and no substitute
// for actually observing 2+ WON deals against the same account).
export async function repeatPurchaseCohort(filter: AnalyticsFilter): Promise<RepeatPurchaseRow[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  // Full won-deal history per account is fetched unbounded by filter.from/to
  // — an account's 1st purchase may sit well before the reporting window,
  // and dropping it would misclassify a genuine 2nd purchase as a 1st. The
  // window instead controls which gaps get counted: only pairs whose LATER
  // deal closed inside [from, to] contribute, so a rep re-running this for
  // last quarter sees last quarter's repeat-purchase gaps, not all of time.
  const wonDeals = await prisma.deal.findMany({
    where: { deletedAt: null, outcome: "WON", closedAt: { not: null }, ...ownerWhere, ...dealChannelWhere },
    select: { accountId: true, closedAt: true },
    orderBy: { closedAt: "asc" },
  });

  const closedDatesByAccount = new Map<string, Date[]>();
  for (const d of wonDeals) {
    const arr = closedDatesByAccount.get(d.accountId) ?? [];
    arr.push(d.closedAt!);
    closedDatesByAccount.set(d.accountId, arr);
  }

  const gapDaysByPairIndex = new Map<number, number[]>();
  for (const dates of closedDatesByAccount.values()) {
    if (dates.length < 2) continue;
    for (let i = 0; i < dates.length - 1; i++) {
      const later = dates[i + 1];
      if (later < filter.from || later > filter.to) continue;
      const days = (later.getTime() - dates[i].getTime()) / 86_400_000;
      const arr = gapDaysByPairIndex.get(i) ?? [];
      arr.push(days);
      gapDaysByPairIndex.set(i, arr);
    }
  }

  // MIN_SAMPLE_SIZE gates on the pair COUNT for that gap index (stat()'s own
  // n), not on how many distinct accounts have any repeat purchase at all —
  // a business with 3 accounts each on their 5th purchase has plenty of
  // "4th→5th" pairs (3) but still too few to trust, while "1st→2nd" might
  // have dozens even from few total accounts once volume grows.
  return [...gapDaysByPairIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pairIndex, days]) => ({
      pairIndex,
      label: `${ordinal(pairIndex + 1)} → ${ordinal(pairIndex + 2)} purchase`,
      ...stat(days),
    }));
}
