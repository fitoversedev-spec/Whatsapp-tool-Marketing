// Phase 3 (analytics v2) — Territory view (A9): a structured bubble/scatter
// chart keyed on City (grouping already proven reliable via geography.ts's
// resolveCity()), not a literal map — no lat/lng or map library exists in
// this repo, and this plan isn't adding one. Distinct from quadrants.ts's
// regionQuadrant (a 4-quadrant volume-vs-win-rate categorization): this is a
// 3-dimensional per-city view — avg deal size, win rate, AND enquiry volume
// (as bubble radius) — for the richer "where are we, city by city" read.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";
import { resolveCity } from "./geography";

export type TerritoryBubble = {
  city: string;
  avgDealSize: number | null; // won value / won count, null below MIN_SAMPLE_SIZE
  winRate: number | null; // won / closed, null below MIN_SAMPLE_SIZE
  enquiryVolume: number; // bubble radius
  n: number; // closed-deal count backing winRate/avgDealSize, so the UI can flag low-confidence bubbles the same way quadrants.ts's lowConfidenceIds does
};

export async function territoryBubbles(filter: AnalyticsFilter): Promise<TerritoryBubble[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const [enquiryDeals, closedDeals] = await Promise.all([
    prisma.deal.findMany({
      where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { siteCity: true, account: { select: { city: true } } },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
      select: { siteCity: true, account: { select: { city: true } }, outcome: true, wonValue: true },
    }),
  ]);

  const enquiryMap = new Map<string, number>();
  for (const d of enquiryDeals) {
    const city = resolveCity(d);
    enquiryMap.set(city, (enquiryMap.get(city) ?? 0) + 1);
  }

  const closedMap = new Map<string, { won: number; closed: number; wonValue: number }>();
  for (const d of closedDeals) {
    const city = resolveCity(d);
    const e = closedMap.get(city) ?? { won: 0, closed: 0, wonValue: 0 };
    e.closed += 1;
    if (d.outcome === "WON") {
      e.won += 1;
      e.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    closedMap.set(city, e);
  }

  // Union, same reasoning as quadrants.ts's leadSourceQuadrant/regionQuadrant:
  // a city can have deals closing this window without a fresh enquiry in it
  // (or vice versa), and dropping either side would silently redefine "all
  // cities" for one axis.
  const allCities = new Set<string>([...enquiryMap.keys(), ...closedMap.keys()]);

  return [...allCities]
    .map((city) => {
      const closed = closedMap.get(city);
      const n = closed?.closed ?? 0;
      return {
        city,
        avgDealSize: closed && closed.won >= MIN_SAMPLE_SIZE ? closed.wonValue / closed.won : null,
        winRate: n >= MIN_SAMPLE_SIZE ? closed!.won / closed!.closed : null,
        enquiryVolume: enquiryMap.get(city) ?? 0,
        n,
      };
    })
    .sort((a, b) => b.enquiryVolume - a.enquiryVolume);
}
