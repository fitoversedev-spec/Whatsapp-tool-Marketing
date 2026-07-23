// Seasonal demand by sport (spec B1). Deliberately reads ALL Deal history,
// not filter.from/to — a seasonal shape needs multiple years overlaid to
// mean anything, so narrowing to whatever date range the UI happens to have
// selected would defeat the point. filter is still used for ownerIds/
// dealChannel scoping (so a rep's self-scoped view only sees their own
// history), just not for the date window. This is the one function in this
// codebase whose date range isn't filter.from/to — see products.ts for the
// normal convention every other analytics function follows.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

export type SeasonalityRow = { sportName: string; month: number; enquiries: number; won: number; wonValue: number };
// null until >=2 distinct calendar years exist in the data — mirrors
// products.ts's distinctYears gate exactly (same threshold, same reasoning:
// a one-year-only overlay isn't a "season", it's just that year's shape).
export type Seasonality = { rows: SeasonalityRow[]; seasonalIndex: Record<string, number[]> | null; distinctYears: number[] };

const UNSPECIFIED_SPORT = "(unspecified sport)";

export async function seasonality(filter: AnalyticsFilter): Promise<Seasonality> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const lineItems = await prisma.dealLineItem.findMany({
    where: { deal: { deletedAt: null, ...ownerWhere, ...dealChannelWhere } },
    select: {
      amount: true,
      quotationId: true,
      quotation: { select: { isPrimary: true } },
      sport: { select: { name: true } },
      deal: { select: { id: true, enquiryAt: true, outcome: true, closedAt: true } },
    },
  });

  // month key is 1-12, combined across every year seen — the whole point of
  // this table is "which month tends to be busy", not "which month in 2025".
  const rowMap = new Map<string, { enquiries: Set<string>; won: number; wonValue: number }>();
  const years = new Set<number>();

  for (const li of lineItems) {
    const sportName = li.sport?.name ?? UNSPECIFIED_SPORT;
    const amount = li.amount ? Number(li.amount) : 0;

    years.add(li.deal.enquiryAt.getFullYear());
    const enquiryKey = `${sportName}|${li.deal.enquiryAt.getMonth() + 1}`;
    const enquiryRow = rowMap.get(enquiryKey) ?? { enquiries: new Set<string>(), won: 0, wonValue: 0 };
    enquiryRow.enquiries.add(li.deal.id);
    rowMap.set(enquiryKey, enquiryRow);

    // Won signal: line item on the primary quotation of a WON deal, same
    // "primary quotation" gate products.ts uses so a deal's line items
    // aren't double-counted across superseded quotation revisions.
    if (li.deal.outcome === "WON" && li.quotation?.isPrimary && li.deal.closedAt) {
      const wonKey = `${sportName}|${li.deal.closedAt.getMonth() + 1}`;
      const wonRow = rowMap.get(wonKey) ?? { enquiries: new Set<string>(), won: 0, wonValue: 0 };
      wonRow.won += 1;
      wonRow.wonValue += amount;
      rowMap.set(wonKey, wonRow);
    }
  }

  const rows: SeasonalityRow[] = [...rowMap.entries()]
    .map(([key, v]) => {
      const [sportName, month] = key.split("|");
      return { sportName, month: Number(month), enquiries: v.enquiries.size, won: v.won, wonValue: v.wonValue };
    })
    .sort((a, b) => (a.sportName === b.sportName ? a.month - b.month : a.sportName.localeCompare(b.sportName)));

  const distinctYears = [...years].sort();
  if (distinctYears.length < 2) {
    return { rows, seasonalIndex: null, distinctYears };
  }

  // Index is enquiry-volume-based (spec: "relative enquiry volume vs that
  // sport's own annual average"), computed off the same combined-across-years
  // monthly totals in `rows` — 1.0 = that sport's average month.
  const monthlyEnquiriesBySport = new Map<string, number[]>();
  for (const row of rows) {
    const arr = monthlyEnquiriesBySport.get(row.sportName) ?? new Array(12).fill(0);
    arr[row.month - 1] += row.enquiries;
    monthlyEnquiriesBySport.set(row.sportName, arr);
  }

  // A sport with only a handful of lifetime enquiries produces a wildly
  // misleading index (e.g. 12.0 in its one active month, 0 everywhere else),
  // so gate each sport on its own total enquiry count — a sport below
  // MIN_SAMPLE_SIZE is omitted from the index entirely rather than shown with
  // a confident-looking-but-meaningless shape, same discipline every rate/
  // median in this codebase follows.
  const seasonalIndex: Record<string, number[]> = {};
  for (const [sportName, arr] of monthlyEnquiriesBySport) {
    const total = arr.reduce((a, b) => a + b, 0);
    if (total < MIN_SAMPLE_SIZE) continue;
    seasonalIndex[sportName] = arr.map((v) => v / (total / 12));
  }

  return { rows, seasonalIndex, distinctYears };
}
