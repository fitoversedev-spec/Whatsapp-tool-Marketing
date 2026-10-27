// The Search Console section: what people typed into Google before landing on the
// site, and which pages Google showed.
import { addDays, todayIST } from "./range";
import type { GscApi, GscQueryResponse } from "./google";
import type { ResolvedRange, SearchData, SearchRow } from "./types";

// Search Console publishes a day's numbers about this many days late.
export const GSC_DELAY_DAYS = 3;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

function rowsOf(res: GscQueryResponse | null | undefined): (SearchRow & { key: string })[] {
  return (res?.rows ?? []).map((r) => ({
    key: r.keys?.[0] ?? "",
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: round(r.ctr ?? 0, 4),
    position: round(r.position ?? 0, 1),
  }));
}

export async function buildSearch(gsc: GscApi, r: ResolvedRange, now: Date = new Date()): Promise<SearchData> {
  const latest = addDays(todayIST(now), -GSC_DELAY_DAYS);
  const to = r.to < latest ? r.to : latest;
  const meta = {
    from: r.from,
    to,
    requestedTo: r.to,
    delayDays: GSC_DELAY_DAYS,
    note: `Search Console data is about ${GSC_DELAY_DAYS} days behind, so the latest days are not in this view.`,
  };
  // A range that starts inside the delay (e.g. "this month" on the 2nd) has no data yet.
  if (r.from > to) return { ...meta, queries: [], pages: [] };

  const window = { startDate: r.from, endDate: to };
  const [queries, pages] = await Promise.all([
    gsc.query({ ...window, dimensions: ["query"], rowLimit: 25 }),
    gsc.query({ ...window, dimensions: ["page"], rowLimit: 10 }),
  ]);
  return {
    ...meta,
    queries: rowsOf(queries).map(({ key, ...stats }) => ({ query: key, ...stats })),
    pages: rowsOf(pages).map(({ key, ...stats }) => ({ page: key, ...stats })),
  };
}
