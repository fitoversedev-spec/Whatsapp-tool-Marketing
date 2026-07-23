// Phase 2 (analytics v2) — Comparators & Patterns group (A3). First real
// caller of AnalyticsFilter's customerProfileIds/stageIds/outcomes — typed
// since Phase 0 but wired into zero functions until now (types.ts's own
// comment confirms this). Admin-only surface; this file stays a pure
// function layer and does not itself enforce that — the API route wraps it.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import { resolveCity } from "./geography";
import { companyBenchmarks, type Benchmarks } from "./benchmarks";
import { fyPair } from "./fiscalYear";

// Shared narrowing for the three generic filter fields this file is the
// first to wire up. Spread this AFTER any hardcoded `outcome`/`currentStageId`
// key in a query's `where` so an explicit filter.outcomes can override a
// function's own default outcome set (e.g. repComparison's default
// WON/LOST "closed" definition) rather than being silently ignored.
function extraDealWhere(filter: AnalyticsFilter) {
  return {
    ...(filter.customerProfileIds?.length ? { account: { customerProfileId: { in: filter.customerProfileIds } } } : {}),
    ...(filter.stageIds?.length ? { currentStageId: { in: filter.stageIds } } : {}),
    ...(filter.outcomes?.length ? { outcome: { in: filter.outcomes } } : {}),
  };
}

function dealsWhere(filter: AnalyticsFilter, extra: ReturnType<typeof extraDealWhere> = {}) {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  return { deletedAt: null, ...ownerWhere, ...dealChannelWhere, ...extra };
}

export type RepComparisonRow = {
  ownerId: string;
  ownerName: string;
  wonRevenue: number;
  winRate: { rate: number | null; n: number };
  avgCycleDays: { days: number | null; n: number };
  avgProjectValue: number | null;
};

// Distinct from kpiBoard.ts's repRankings (a KPI-board-scoped summary derived
// from salesActivity() as-is) — this is the dedicated comparison view, same
// per-owner query shape as salesActivity.ts but wired for
// customerProfileIds/stageIds/outcomes narrowing.
export async function repComparison(filter: AnalyticsFilter): Promise<RepComparisonRow[]> {
  const ownerWhere = filter.ownerIds?.length ? { id: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  const extra = extraDealWhere(filter);

  const [owners, closedDeals] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true, ...ownerWhere },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.deal.findMany({
      where: {
        outcome: { in: ["WON", "LOST"] },
        closedAt: { gte: filter.from, lte: filter.to },
        ownerUserId: { not: null },
        ...dealChannelWhere,
        ...extra,
      },
      select: { ownerUserId: true, outcome: true, wonValue: true, enquiryAt: true, closedAt: true },
    }),
  ]);

  const byOwner = new Map<string, { won: number; closed: number; wonValue: number; cycleDaysSum: number; cycleN: number }>();
  for (const d of closedDeals) {
    if (!d.ownerUserId) continue;
    const e = byOwner.get(d.ownerUserId) ?? { won: 0, closed: 0, wonValue: 0, cycleDaysSum: 0, cycleN: 0 };
    e.closed += 1;
    if (d.outcome === "WON") {
      e.won += 1;
      e.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    if (d.closedAt) {
      e.cycleDaysSum += (d.closedAt.getTime() - d.enquiryAt.getTime()) / 86_400_000;
      e.cycleN += 1;
    }
    byOwner.set(d.ownerUserId, e);
  }

  return owners
    .map((u) => {
      const e = byOwner.get(u.id) ?? { won: 0, closed: 0, wonValue: 0, cycleDaysSum: 0, cycleN: 0 };
      return {
        ownerId: u.id,
        ownerName: u.name,
        wonRevenue: e.wonValue,
        winRate: { rate: e.closed >= MIN_SAMPLE_SIZE ? e.won / e.closed : null, n: e.closed },
        avgCycleDays: { days: e.cycleN >= MIN_SAMPLE_SIZE ? e.cycleDaysSum / e.cycleN : null, n: e.cycleN },
        avgProjectValue: e.won >= MIN_SAMPLE_SIZE ? e.wonValue / e.won : null,
      };
    })
    .sort((a, b) => b.wonRevenue - a.wonRevenue);
}

export type DimensionComparisonRow = { label: string; enquiries: number; won: number; wonValue: number; winRate: number | null };

function toDimensionRows(map: Map<string, { enquiries: number; won: number; wonValue: number }>): DimensionComparisonRow[] {
  return [...map.entries()]
    .map(([label, v]) => ({
      label,
      enquiries: v.enquiries,
      won: v.won,
      wonValue: v.wonValue,
      winRate: v.enquiries >= MIN_SAMPLE_SIZE ? v.won / v.enquiries : null,
    }))
    .sort((a, b) => b.enquiries - a.enquiries);
}

async function regionComparison(filter: AnalyticsFilter): Promise<DimensionComparisonRow[]> {
  const deals = await prisma.deal.findMany({
    where: { ...dealsWhere(filter, extraDealWhere(filter)), createdAt: { gte: filter.from, lte: filter.to } },
    select: { siteCity: true, account: { select: { city: true } }, outcome: true, wonValue: true },
  });
  const map = new Map<string, { enquiries: number; won: number; wonValue: number }>();
  for (const d of deals) {
    const label = resolveCity(d);
    const e = map.get(label) ?? { enquiries: 0, won: 0, wonValue: 0 };
    e.enquiries += 1;
    if (d.outcome === "WON") {
      e.won += 1;
      e.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    map.set(label, e);
  }
  return toDimensionRows(map);
}

async function sectorComparison(filter: AnalyticsFilter): Promise<DimensionComparisonRow[]> {
  const deals = await prisma.deal.findMany({
    where: { ...dealsWhere(filter, extraDealWhere(filter)), createdAt: { gte: filter.from, lte: filter.to } },
    select: { account: { select: { customerProfile: { select: { name: true } } } }, outcome: true, wonValue: true },
  });
  const map = new Map<string, { enquiries: number; won: number; wonValue: number }>();
  for (const d of deals) {
    // Same "(unclassified)" fallback products.ts uses for a deal whose
    // account was never assigned a CustomerProfile.
    const label = d.account.customerProfile?.name ?? "(unclassified)";
    const e = map.get(label) ?? { enquiries: 0, won: 0, wonValue: 0 };
    e.enquiries += 1;
    if (d.outcome === "WON") {
      e.won += 1;
      e.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    map.set(label, e);
  }
  return toDimensionRows(map);
}

async function sourceComparison(filter: AnalyticsFilter): Promise<DimensionComparisonRow[]> {
  const [sourceTaxonomy, deals] = await Promise.all([
    prisma.leadSource.findMany({ select: { id: true, name: true } }),
    prisma.deal.findMany({
      where: { ...dealsWhere(filter, extraDealWhere(filter)), createdAt: { gte: filter.from, lte: filter.to } },
      select: { leadSourceId: true, outcome: true, wonValue: true },
    }),
  ]);
  const nameById = new Map(sourceTaxonomy.map((s) => [s.id, s.name]));
  const nameFor = (id: string | null) => (id ? nameById.get(id) ?? "(unknown source)" : "(unspecified)");

  const map = new Map<string, { enquiries: number; won: number; wonValue: number }>();
  for (const d of deals) {
    const label = nameFor(d.leadSourceId);
    const e = map.get(label) ?? { enquiries: 0, won: 0, wonValue: 0 };
    e.enquiries += 1;
    if (d.outcome === "WON") {
      e.won += 1;
      e.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    map.set(label, e);
  }
  return toDimensionRows(map);
}

async function productComparison(filter: AnalyticsFilter): Promise<DimensionComparisonRow[]> {
  const lineItems = await prisma.dealLineItem.findMany({
    where: {
      deal: dealsWhere(filter, extraDealWhere(filter)),
      OR: [
        { deal: { enquiryAt: { gte: filter.from, lte: filter.to } } },
        { deal: { outcome: "WON", closedAt: { gte: filter.from, lte: filter.to } } },
      ],
    },
    select: {
      amount: true,
      label: true,
      product: { select: { name: true } },
      quotation: { select: { isPrimary: true } },
      deal: { select: { id: true, enquiryAt: true, outcome: true, closedAt: true } },
    },
  });

  const map = new Map<string, { enquiries: Set<string>; won: number; wonValue: number }>();
  for (const li of lineItems) {
    // Same product-name resolution as products.ts: prefer the matched
    // catalogue SKU, fall back to the quote line's own free-text label.
    const label = li.product?.name ?? li.label ?? "(unspecified)";
    const amount = li.amount ? Number(li.amount) : 0;
    const e = map.get(label) ?? { enquiries: new Set<string>(), won: 0, wonValue: 0 };

    if (li.deal.enquiryAt >= filter.from && li.deal.enquiryAt <= filter.to) {
      e.enquiries.add(li.deal.id);
    }
    // Won signal keyed on the primary quotation, same as products.ts, so a
    // line item on a superseded revision doesn't double-count won value.
    if (li.deal.outcome === "WON" && li.quotation?.isPrimary && li.deal.closedAt && li.deal.closedAt >= filter.from && li.deal.closedAt <= filter.to) {
      e.won += 1;
      e.wonValue += amount;
    }
    map.set(label, e);
  }

  return [...map.entries()]
    .map(([label, v]) => ({
      label,
      enquiries: v.enquiries.size,
      won: v.won,
      wonValue: v.wonValue,
      winRate: v.enquiries.size >= MIN_SAMPLE_SIZE ? v.won / v.enquiries.size : null,
    }))
    .sort((a, b) => b.enquiries - a.enquiries);
}

export async function dimensionComparison(
  dimension: "region" | "sector" | "product" | "source",
  filter: AnalyticsFilter,
): Promise<DimensionComparisonRow[]> {
  switch (dimension) {
    case "region":
      return regionComparison(filter);
    case "sector":
      return sectorComparison(filter);
    case "product":
      return productComparison(filter);
    case "source":
      return sourceComparison(filter);
  }
}

export type FyBenchmark = Benchmarks & { label: string };

// The concrete "FY-vs-FY" comparator — dimension-vs-itself period-over-period
// is just dimensionComparison() called twice with two date-bounded filters,
// so no separate generic abstraction is built for that; this one is genuinely
// distinct because it needs fiscalYear.ts's FY boundaries, not an arbitrary
// caller-supplied range.
export async function fyComparison(scope: AnalyticsFilter): Promise<{ current: FyBenchmark; previous: FyBenchmark }> {
  const { current, previous } = fyPair();
  const [currentBench, previousBench] = await Promise.all([
    companyBenchmarks({ ...scope, from: current.start, to: current.end }),
    companyBenchmarks({ ...scope, from: previous.start, to: previous.end }),
  ]);
  return { current: { ...currentBench, label: current.label }, previous: { ...previousBench, label: previous.label } };
}
