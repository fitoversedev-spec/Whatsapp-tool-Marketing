// Phase 3 (analytics v2) — Quadrants group (A8): four two-axis scatter views
// (Lead Source, Product, Rep, Region) splitting a volume/growth/activity
// dimension against win rate, boundary lines drawn from real company
// benchmarks (benchmarks.ts) rather than a fixed constant, per the plan.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import { resolveCity } from "./geography";
import { companyBenchmarks } from "./benchmarks";
import { salesActivity } from "./salesActivity";
import { isFlooringLine } from "./products";

export type QuadrantPoint = {
  id: string;
  label: string;
  x: number;
  y: number;
  n: number; // sample size behind this point, used for low-confidence flagging
};
export type QuadrantResult = {
  points: QuadrantPoint[];
  xBenchmark: number;
  yBenchmark: number;
  xLabel: string;
  yLabel: string;
  lowConfidenceIds: string[];
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// yBenchmark is always the real trailing company win rate. companyBenchmarks
// already forces company-wide (ownerIds cleared, dealChannel:"crm") inside
// itself regardless of what's passed in, matching how comparators.ts's
// fyComparison/repComparison already lean on it as THE baseline. The 0.5
// fallback only fires when the company itself has fewer than
// MIN_SAMPLE_SIZE closed deals company-wide in the window — expected to be
// rare — and it only moves the dashed reference line, never hides a point.
async function yBenchmarkFor(filter: AnalyticsFilter): Promise<number> {
  const bench = await companyBenchmarks(filter);
  return bench.trailingWinRate ?? 0.5;
}

function finalize(points: QuadrantPoint[], yBenchmark: number, xLabel: string, yLabel: string, xBenchmarkOverride?: number): QuadrantResult {
  const xBenchmark = xBenchmarkOverride ?? median(points.map((p) => p.x));
  const lowConfidenceIds = points.filter((p) => p.n < MIN_SAMPLE_SIZE).map((p) => p.id);
  return { points, xBenchmark, yBenchmark, xLabel, yLabel, lowConfidenceIds };
}

export async function leadSourceQuadrant(filter: AnalyticsFilter): Promise<QuadrantResult> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const [sourceTaxonomy, enquiryDeals, closedDeals, yBenchmark] = await Promise.all([
    prisma.leadSource.findMany({ select: { id: true, name: true } }),
    prisma.deal.findMany({
      where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { leadSourceId: true },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { leadSourceId: true, outcome: true },
    }),
    yBenchmarkFor(filter),
  ]);

  const nameById = new Map(sourceTaxonomy.map((s) => [s.id, s.name]));
  const nameFor = (id: string | null) => (id ? nameById.get(id) ?? "(unknown source)" : "(unspecified)");

  const enquiryMap = new Map<string, number>();
  for (const d of enquiryDeals) {
    const name = nameFor(d.leadSourceId);
    enquiryMap.set(name, (enquiryMap.get(name) ?? 0) + 1);
  }

  const closedMap = new Map<string, { won: number; closed: number }>();
  for (const d of closedDeals) {
    const name = nameFor(d.leadSourceId);
    const e = closedMap.get(name) ?? { won: 0, closed: 0 };
    e.closed += 1;
    if (d.outcome === "WON") e.won += 1;
    closedMap.set(name, e);
  }

  // Union, not just enquiryMap's keys — a source can have deals that closed
  // in this window without any brand-new enquiry landing in it (e.g. an
  // older pipeline deal finally closing), and dropping it would silently
  // change what "all lead sources" means for the win-rate axis.
  const allNames = new Set<string>([...enquiryMap.keys(), ...closedMap.keys()]);
  const points: QuadrantPoint[] = [...allNames].map((name) => {
    const closed = closedMap.get(name);
    return {
      id: name,
      label: name,
      x: enquiryMap.get(name) ?? 0,
      // No closed deals yet for this source in the window: represented as
      // y=0 ("nothing won to show"), not dropped — it still renders (at
      // n=0, so always low-confidence) rather than vanishing from the plot.
      y: closed && closed.closed > 0 ? closed.won / closed.closed : 0,
      n: closed?.closed ?? 0,
    };
  });

  return finalize(points, yBenchmark, "Enquiry volume", "Win rate");
}

export async function productQuadrant(filter: AnalyticsFilter): Promise<QuadrantResult> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  // "The immediately preceding period of equal length": e.g. filter =
  // [Jun 1, Jun 30] (29d + change) -> previous = the same-length window
  // ending the instant before filter.from, non-overlapping with it.
  const windowMs = filter.to.getTime() - filter.from.getTime();
  const prevTo = new Date(filter.from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - windowMs);

  const lineItemSelect = { label: true, product: { select: { name: true } }, deal: { select: { id: true } } } as const;

  const [currentLineItems, previousLineItems, closedLineItems, yBenchmark] = await Promise.all([
    prisma.dealLineItem.findMany({
      where: { deal: { deletedAt: null, enquiryAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere } },
      select: lineItemSelect,
    }),
    prisma.dealLineItem.findMany({
      where: { deal: { deletedAt: null, enquiryAt: { gte: prevFrom, lte: prevTo }, ...ownerWhere, ...dealChannelWhere } },
      select: lineItemSelect,
    }),
    // Won/lost signal restricted to the primary quotation's line items (or
    // no quotation at all) — same convention products.ts uses to avoid a
    // superseded revision's line items counting as this deal's product mix.
    prisma.dealLineItem.findMany({
      where: {
        deal: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      },
      select: { label: true, product: { select: { name: true } }, quotationId: true, quotation: { select: { isPrimary: true } }, deal: { select: { id: true, outcome: true } } },
    }),
    yBenchmarkFor(filter),
  ]);

  const nameOf = (li: { label: string | null; product: { name: string } | null }) => li.product?.name ?? li.label ?? "(unspecified)";

  function distinctDealsByProduct(rows: { label: string | null; product: { name: string } | null; deal: { id: string } }[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const li of rows.filter(isFlooringLine)) {
      const name = nameOf(li);
      const set = map.get(name) ?? new Set<string>();
      set.add(li.deal.id);
      map.set(name, set);
    }
    return map;
  }

  const currentMap = distinctDealsByProduct(currentLineItems);
  const previousMap = distinctDealsByProduct(previousLineItems);

  const closedMap = new Map<string, { won: Set<string>; closed: Set<string> }>();
  for (const li of closedLineItems.filter(isFlooringLine)) {
    if (li.quotationId && !li.quotation?.isPrimary) continue;
    const name = nameOf(li);
    const e = closedMap.get(name) ?? { won: new Set<string>(), closed: new Set<string>() };
    e.closed.add(li.deal.id);
    if (li.deal.outcome === "WON") e.won.add(li.deal.id);
    closedMap.set(name, e);
  }

  const allProducts = new Set<string>([...currentMap.keys(), ...previousMap.keys(), ...closedMap.keys()]);
  const points: QuadrantPoint[] = [...allProducts].map((name) => {
    const current = currentMap.get(name)?.size ?? 0;
    const previous = previousMap.get(name)?.size ?? 0;
    // Growth % vs the prior period. A product with zero enquiries last
    // period can't take a ratio — treated as +100% ("went from nothing to
    // something") if it has any enquiries now, else 0% (still nothing),
    // rather than letting +Infinity/NaN reach the chart.
    const growth = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
    const closed = closedMap.get(name);
    return {
      id: name,
      label: name,
      x: growth,
      y: closed && closed.closed.size > 0 ? closed.won.size / closed.closed.size : 0,
      n: closed?.closed.size ?? 0,
    };
  });

  // xBenchmark is fixed at 0 (growing vs shrinking), not a median of growth
  // rates — the plan's explicit instruction, since growth is already a
  // percentage with a natural zero line, unlike raw volume counts.
  return finalize(points, yBenchmark, "Enquiry growth vs prior period (%)", "Win rate", 0);
}

export async function repQuadrant(filter: AnalyticsFilter): Promise<QuadrantResult> {
  const [rows, yBenchmark] = await Promise.all([salesActivity(filter), yBenchmarkFor(filter)]);

  const points: QuadrantPoint[] = rows.map((r) => ({
    id: r.ownerId,
    label: r.ownerName,
    // Activity score: exactly the three raw counts the plan names, summed —
    // not a new weighted metric.
    x: r.dealsCreated + r.siteVisits + r.samplesSent,
    y: r.winRate ?? 0,
    n: r.dealsClosed,
  }));

  return finalize(points, yBenchmark, "Activity score (deals created + site visits + samples sent)", "Win rate");
}

export async function regionQuadrant(filter: AnalyticsFilter): Promise<QuadrantResult> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const [enquiryDeals, closedDeals, yBenchmark] = await Promise.all([
    prisma.deal.findMany({
      where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { siteCity: true, account: { select: { city: true } } },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { siteCity: true, account: { select: { city: true } }, outcome: true },
    }),
    yBenchmarkFor(filter),
  ]);

  const enquiryMap = new Map<string, number>();
  for (const d of enquiryDeals) {
    const city = resolveCity(d);
    enquiryMap.set(city, (enquiryMap.get(city) ?? 0) + 1);
  }

  const closedMap = new Map<string, { won: number; closed: number }>();
  for (const d of closedDeals) {
    const city = resolveCity(d);
    const e = closedMap.get(city) ?? { won: 0, closed: 0 };
    e.closed += 1;
    if (d.outcome === "WON") e.won += 1;
    closedMap.set(city, e);
  }

  const allCities = new Set<string>([...enquiryMap.keys(), ...closedMap.keys()]);
  const points: QuadrantPoint[] = [...allCities].map((city) => {
    const closed = closedMap.get(city);
    return {
      id: city,
      label: city,
      x: enquiryMap.get(city) ?? 0,
      y: closed && closed.closed > 0 ? closed.won / closed.closed : 0,
      n: closed?.closed ?? 0,
    };
  });

  return finalize(points, yBenchmark, "Enquiry volume", "Win rate");
}
