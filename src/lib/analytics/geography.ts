// City table (spec §11.3.D): enquiries, quotations, won, won value, win
// rate, avg deal size, avg cycle, grouped by city. Tier rollup uses
// Deal.siteCityTierId — most deals won't have one set yet (city->tier
// mapping is data gap #1), so an "Unclassified" bucket is always shown
// rather than silently dropping those deals (spec §4.3's explicit instruction).
//
// City itself prefers Deal.siteCity (the actual install-site location, when
// someone bothered to set it) but falls back to the deal's Account.city —
// the Location captured when the contact/company was created or imported.
// Almost every deal has THAT; very few have a distinct siteCity, so without
// this fallback nearly everything landed in "(unspecified)" (explicit user
// report — see resolveCity below).
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

export function resolveCity(d: { siteCity: string | null; account: { city: string | null } }): string {
  return d.siteCity?.trim() || d.account.city?.trim() || "(unspecified)";
}

export type CityRow = {
  city: string;
  enquiries: number;
  quotations: number;
  won: number;
  wonValue: number;
  winRate: number | null;
  avgDealSize: number | null;
  avgCycleDays: number | null; // null if fewer than MIN_SAMPLE_SIZE closed deals
};

export type TierRow = {
  tierName: string; // "Unclassified" for null cityTierId
  enquiries: number;
  won: number;
  wonValue: number;
};

export async function geography(filter: AnalyticsFilter): Promise<{ cities: CityRow[]; tiers: TierRow[] }> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  const deals = await prisma.deal.findMany({
    where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
    select: {
      siteCity: true,
      account: { select: { city: true } },
      siteCityTier: { select: { name: true } },
      outcome: true,
      wonValue: true,
      quotations: { select: { id: true }, where: { status: "sent" } },
    },
  });

  // Cycle time is measured over deals that CLOSED in the window (not
  // created in it) — same distinction salesActivity.ts makes, otherwise a
  // burst of brand-new deals would silently drag the average down.
  const closedDeals = await prisma.deal.findMany({
    where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
    select: { siteCity: true, account: { select: { city: true } }, enquiryAt: true, closedAt: true },
  });

  const cityMap = new Map<string, { enquiries: number; quotations: number; won: number; wonValue: number }>();
  const tierMap = new Map<string, { enquiries: number; won: number; wonValue: number }>();
  const cycleMap = new Map<string, { sum: number; n: number }>();

  for (const d of deals) {
    const city = resolveCity(d);
    const cEntry = cityMap.get(city) ?? { enquiries: 0, quotations: 0, won: 0, wonValue: 0 };
    cEntry.enquiries += 1;
    cEntry.quotations += d.quotations.length > 0 ? 1 : 0;
    if (d.outcome === "WON") {
      cEntry.won += 1;
      cEntry.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    cityMap.set(city, cEntry);

    const tier = d.siteCityTier?.name ?? "Unclassified";
    const tEntry = tierMap.get(tier) ?? { enquiries: 0, won: 0, wonValue: 0 };
    tEntry.enquiries += 1;
    if (d.outcome === "WON") {
      tEntry.won += 1;
      tEntry.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    tierMap.set(tier, tEntry);
  }

  for (const d of closedDeals) {
    if (!d.closedAt) continue;
    const city = resolveCity(d);
    const entry = cycleMap.get(city) ?? { sum: 0, n: 0 };
    entry.sum += (d.closedAt.getTime() - d.enquiryAt.getTime()) / 86_400_000;
    entry.n += 1;
    cycleMap.set(city, entry);
  }

  const cities: CityRow[] = [...cityMap.entries()]
    .map(([city, v]) => {
      const cycle = cycleMap.get(city);
      return {
        city,
        enquiries: v.enquiries,
        quotations: v.quotations,
        won: v.won,
        wonValue: v.wonValue,
        winRate: v.enquiries > 0 ? v.won / v.enquiries : null,
        avgDealSize: v.won > 0 ? v.wonValue / v.won : null,
        avgCycleDays: cycle && cycle.n >= MIN_SAMPLE_SIZE ? cycle.sum / cycle.n : null,
      };
    })
    .sort((a, b) => b.enquiries - a.enquiries);

  const tiers: TierRow[] = [...tierMap.entries()]
    .map(([tierName, v]) => ({ tierName, ...v }))
    .sort((a, b) => (a.tierName === "Unclassified" ? 1 : b.tierName === "Unclassified" ? -1 : a.tierName.localeCompare(b.tierName)));

  return { cities, tiers };
}
