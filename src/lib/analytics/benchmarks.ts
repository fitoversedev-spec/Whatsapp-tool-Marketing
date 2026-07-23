// Rolling company-wide baseline every comparator/anomaly-rule phase measures
// a rep/segment/period against. Computed on-demand (no cached table) —
// reuses salesActivity.ts's exact query shapes rather than re-deriving them,
// called with dealChannel:"crm" and no ownerIds so it aggregates every rep.
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import { salesActivity } from "./salesActivity";

export type Benchmarks = { trailingWinRate: number | null; avgCycleDays: number | null; avgProjectValue: number | null };

export async function companyBenchmarks(filter: AnalyticsFilter): Promise<Benchmarks> {
  const rows = await salesActivity({ ...filter, ownerIds: undefined, dealChannel: "crm" });

  let totalWon = 0;
  let totalClosed = 0;
  let totalWonValue = 0;
  let cycleDaysWeighted = 0;
  let cycleN = 0;
  for (const r of rows) {
    totalWon += r.dealsWon;
    totalClosed += r.dealsClosed;
    totalWonValue += r.wonValue;
    if (r.avgCycleDays != null) {
      cycleDaysWeighted += r.avgCycleDays * r.dealsClosed;
      cycleN += r.dealsClosed;
    }
  }

  return {
    trailingWinRate: totalClosed >= MIN_SAMPLE_SIZE ? totalWon / totalClosed : null,
    avgCycleDays: cycleN >= MIN_SAMPLE_SIZE ? cycleDaysWeighted / cycleN : null,
    avgProjectValue: totalWon >= MIN_SAMPLE_SIZE ? totalWonValue / totalWon : null,
  };
}
