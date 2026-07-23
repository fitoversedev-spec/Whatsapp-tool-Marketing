// Referral-partner scoreboard (spec B4). Deal.sourceDetail is 100% freeform
// text — nothing constrains it anywhere (src/app/api/deals/route.ts's own
// comment confirms this) — so this groups on the raw trimmed string, same
// "(unspecified)" fallback convention as sources.ts/comparators.ts, and does
// NOT attempt case-normalization or fuzzy-matching: no such normalization
// exists anywhere else in the codebase for this field, so this isn't the
// place to invent one. The point is to surface the honest fragmentation
// signal, not to quietly clean it up.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

export type ReferralRow = { sourceDetail: string; enquiries: number; won: number; wonValue: number; winRate: number | null };
export type ReferralScoreboard = { rows: ReferralRow[]; distinctValueCount: number; likelyFragmented: boolean };

// A visible default, not a confirmed business threshold (same status as
// products.ts's LOW_CONVERSION_THRESHOLD): more than 30% of raw sourceDetail
// values being distinct strings suggests the same referrer is being typed
// differently deal-to-deal rather than genuinely reflecting that many
// distinct partners.
const FRAGMENTATION_RATIO_THRESHOLD = 0.3;

export async function referralScoreboard(filter: AnalyticsFilter): Promise<ReferralScoreboard> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const deals = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      createdAt: { gte: filter.from, lte: filter.to },
      ...ownerWhere,
      ...dealChannelWhere,
    },
    select: { sourceDetail: true, outcome: true, wonValue: true },
  });

  const map = new Map<string, { enquiries: number; won: number; wonValue: number }>();
  for (const d of deals) {
    const label = d.sourceDetail?.trim() || "(unspecified)";
    const e = map.get(label) ?? { enquiries: 0, won: 0, wonValue: 0 };
    e.enquiries += 1;
    if (d.outcome === "WON") {
      e.won += 1;
      e.wonValue += d.wonValue ? Number(d.wonValue) : 0;
    }
    map.set(label, e);
  }

  const rows: ReferralRow[] = [...map.entries()]
    .map(([sourceDetail, v]) => ({
      sourceDetail,
      enquiries: v.enquiries,
      won: v.won,
      wonValue: v.wonValue,
      winRate: v.enquiries >= MIN_SAMPLE_SIZE ? v.won / v.enquiries : null,
    }))
    .sort((a, b) => b.enquiries - a.enquiries);

  // "(unspecified)" is missing data, not fragmentation of a real freeform
  // value — excluded from both sides of the ratio so a large blank bucket
  // doesn't mask (or manufacture) a fragmentation signal.
  const namedRows = rows.filter((r) => r.sourceDetail !== "(unspecified)");
  const distinctValueCount = namedRows.length;
  const totalNamedEnquiries = namedRows.reduce((sum, r) => sum + r.enquiries, 0);
  const likelyFragmented = totalNamedEnquiries > 0 && distinctValueCount > totalNamedEnquiries * FRAGMENTATION_RATIO_THRESHOLD;

  return { rows, distinctValueCount, likelyFragmented };
}
