// Role-aware landing overview (spec §11.3.A) — the Manager/Management half
// only: team pipeline this-month-vs-last, top movers. Lives as a tab inside
// the existing Team Performance page rather than a new top-level /dashboard
// route, per the standing instruction that all 9 analytics screens stay
// nested there.
//
// The spec's other half — a personal "My Day" landing for individual sales
// reps — is NOT built here. /team (page + API) is hard-gated to admin-only
// today, predating this build; a rep can never reach a tab on this page
// regardless of what's on it. Making that view reachable means reconsidering
// the access gate, which also exposes every rep's own numbers next to their
// peers' (the Sales Activity tab ranks everyone) — a real access-control/
// privacy call, not a rendering detail, so it's deferred rather than
// silently decided. See docs/DATA_GAPS.md.
import { salesActivity } from "./salesActivity";

export type PeriodTotals = { quotationsSent: number; quotedValue: number; dealsWon: number; wonValue: number };
export type MoverRow = { ownerName: string; wonValueDelta: number; thisPeriodWonValue: number; lastPeriodWonValue: number };

function totals(rows: Awaited<ReturnType<typeof salesActivity>>): PeriodTotals {
  return rows.reduce(
    (acc, r) => ({
      quotationsSent: acc.quotationsSent + r.quotationsSentInclRevisions,
      quotedValue: acc.quotedValue + r.quotedValue,
      dealsWon: acc.dealsWon + r.dealsWon,
      wonValue: acc.wonValue + r.wonValue,
    }),
    { quotationsSent: 0, quotedValue: 0, dealsWon: 0, wonValue: 0 },
  );
}

export async function overview(): Promise<{ thisMonth: PeriodTotals; lastMonth: PeriodTotals; topMovers: MoverRow[] }> {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(thisMonthStart.getTime() - 1);

  const [thisRows, lastRows] = await Promise.all([
    salesActivity({ from: thisMonthStart, to: now }),
    salesActivity({ from: lastMonthStart, to: lastMonthEnd }),
  ]);

  const lastByOwner = new Map(lastRows.map((r) => [r.ownerId, r]));
  const topMovers: MoverRow[] = thisRows
    .map((r) => {
      const lastWon = lastByOwner.get(r.ownerId)?.wonValue ?? 0;
      return { ownerName: r.ownerName, wonValueDelta: r.wonValue - lastWon, thisPeriodWonValue: r.wonValue, lastPeriodWonValue: lastWon };
    })
    .sort((a, b) => Math.abs(b.wonValueDelta) - Math.abs(a.wonValueDelta))
    .slice(0, 5);

  return { thisMonth: totals(thisRows), lastMonth: totals(lastRows), topMovers };
}
