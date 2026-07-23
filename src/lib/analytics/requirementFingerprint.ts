// Per-CustomerProfile requirement fingerprint (spec B5) — "what does a
// school/apartment/etc. typically want": dominant sports/products, typical
// site area, typical deal value, dominant lead source. Grouped the same way
// products.ts groups by product: via the deal's own Account.customerProfile,
// with an "(unclassified)" bucket for deals whose account has none set.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

// Top-N by line-item frequency for the sports/products lists — a visible
// display choice (matches the card layout), not a spec-mandated number.
const TOP_N = 3;

export type ProfileFingerprint = {
  profileName: string; // "(unclassified)" for null CustomerProfile
  dealCount: number;
  dominantSports: string[]; // top TOP_N sports by line-item frequency
  dominantProducts: string[]; // top TOP_N products by line-item frequency
  avgAreaSqFt: number | null; // MIN_SAMPLE_SIZE-gated on primary-sent-quotation count
  avgWonValue: number | null; // MIN_SAMPLE_SIZE-gated on won-deal count
  dominantSource: string; // most common LeadSource name, or "(unspecified)"
};

export async function requirementFingerprint(filter: AnalyticsFilter): Promise<ProfileFingerprint[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const deals = await prisma.deal.findMany({
    where: { deletedAt: null, createdAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere },
    select: {
      outcome: true,
      wonValue: true,
      account: { select: { customerProfile: { select: { name: true } } } },
      leadSource: { select: { name: true } },
      lineItems: { select: { label: true, product: { select: { name: true } }, sport: { select: { name: true } } } },
      // Area comes from the real lengthFt/widthFt Int fields on the
      // deal's primary, actually-sent quotation(s) — not the JSON
      // lineItems snapshot, which isn't a queryable relation.
      quotations: {
        where: { isPrimary: true, sentAt: { not: null } },
        select: { lengthFt: true, widthFt: true },
      },
    },
  });

  type Agg = {
    dealCount: number;
    sportCounts: Map<string, number>;
    productCounts: Map<string, number>;
    sourceCounts: Map<string, number>;
    areaSum: number;
    areaN: number;
    wonSum: number;
    wonN: number;
  };
  const byProfile = new Map<string, Agg>();

  for (const d of deals) {
    const profileName = d.account.customerProfile?.name ?? "(unclassified)";
    const agg = byProfile.get(profileName) ?? {
      dealCount: 0,
      sportCounts: new Map<string, number>(),
      productCounts: new Map<string, number>(),
      sourceCounts: new Map<string, number>(),
      areaSum: 0,
      areaN: 0,
      wonSum: 0,
      wonN: 0,
    };
    agg.dealCount += 1;

    for (const li of d.lineItems) {
      // sportId is null-by-design pre-quotation (see Deal API's own
      // comment) — bucket rather than guess, same as products.ts's
      // "(unspecified)" convention for unmatched products.
      const sportName = li.sport?.name ?? "(unspecified sport)";
      agg.sportCounts.set(sportName, (agg.sportCounts.get(sportName) ?? 0) + 1);

      const productName = li.product?.name ?? li.label ?? "(unspecified)";
      agg.productCounts.set(productName, (agg.productCounts.get(productName) ?? 0) + 1);
    }

    const sourceName = d.leadSource?.name ?? "(unspecified)";
    agg.sourceCounts.set(sourceName, (agg.sourceCounts.get(sourceName) ?? 0) + 1);

    for (const q of d.quotations) {
      agg.areaSum += q.lengthFt * q.widthFt;
      agg.areaN += 1;
    }

    if (d.outcome === "WON" && d.wonValue != null) {
      agg.wonSum += Number(d.wonValue);
      agg.wonN += 1;
    }

    byProfile.set(profileName, agg);
  }

  const topN = (counts: Map<string, number>, n: number): string[] =>
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name]) => name);

  const dominant = (counts: Map<string, number>): string => {
    let best = "(unspecified)";
    let bestCount = -1;
    for (const [name, count] of counts) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    return best;
  };

  return [...byProfile.entries()]
    .map(([profileName, agg]) => ({
      profileName,
      dealCount: agg.dealCount,
      dominantSports: topN(agg.sportCounts, TOP_N),
      dominantProducts: topN(agg.productCounts, TOP_N),
      avgAreaSqFt: agg.areaN >= MIN_SAMPLE_SIZE ? agg.areaSum / agg.areaN : null,
      avgWonValue: agg.wonN >= MIN_SAMPLE_SIZE ? agg.wonSum / agg.wonN : null,
      dominantSource: dominant(agg.sourceCounts),
    }))
    .sort((a, b) => b.dealCount - a.dealCount);
}
