// Phase 4 (analytics v2) — B6, win/loss by segment: cross-cuts the existing
// LossReason taxonomy (funnel.ts's funnelSnapshot already does this flat,
// company-wide) by ONE chosen dimension at a time. Deliberately not a 3-way
// matrix (sector x region x product x reason) — at this business's volume
// that mostly produces suppressed single-digit cells, per the plan.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { resolveCity } from "./geography";
import { isFlooringLine } from "./products";

export type WinLossSegmentRow = { segmentLabel: string; reasonName: string; wonCount: number; lostCount: number };

function reasonFor(d: { lossReasonNote: string | null; lossReason: { name: string } | null }): string {
  return d.lossReason?.name ?? d.lossReasonNote ?? "(no reason given)";
}

export async function winLossBySegment(dimension: "sector" | "region" | "product", filter: AnalyticsFilter): Promise<WinLossSegmentRow[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};
  const closedWhere = { deletedAt: null, outcome: { in: ["WON", "LOST"] }, closedAt: { gte: filter.from, lte: filter.to }, ...ownerWhere, ...dealChannelWhere };

  const wonCounts = new Map<string, number>(); // key: segmentLabel
  const lostCounts = new Map<string, number>(); // key: `${segmentLabel}|${reasonName}`

  if (dimension === "product") {
    // Product is a per-line-item attribute, not a per-deal one — a deal can
    // carry more than one product, so unlike sector/region this cross-cut
    // joins through DealLineItem, restricted to the primary quotation's
    // lines (or no quotation at all) exactly like quadrants.ts's
    // productQuadrant, and scoped flooring-only like the rest of products.ts.
    const lineItems = await prisma.dealLineItem.findMany({
      where: { deal: closedWhere },
      select: {
        label: true,
        product: { select: { name: true } },
        quotationId: true,
        quotation: { select: { isPrimary: true } },
        deal: { select: { id: true, outcome: true, lossReasonNote: true, lossReason: { select: { name: true } } } },
      },
    });

    // A deal can have multiple line items resolving to the same product
    // name (e.g. two labels for the same catalogue SKU) — dedupe so one
    // deal's win/loss is never double-counted for that segment.
    const seenWon = new Set<string>();
    const seenLost = new Set<string>();
    for (const li of lineItems.filter(isFlooringLine)) {
      if (li.quotationId && !li.quotation?.isPrimary) continue;
      const segment = li.product?.name ?? li.label ?? "(unspecified)";
      if (li.deal.outcome === "WON") {
        const dedupeKey = `${segment}|${li.deal.id}`;
        if (seenWon.has(dedupeKey)) continue;
        seenWon.add(dedupeKey);
        wonCounts.set(segment, (wonCounts.get(segment) ?? 0) + 1);
      } else {
        const key = `${segment}|${reasonFor(li.deal)}`;
        const dedupeKey = `${key}|${li.deal.id}`;
        if (seenLost.has(dedupeKey)) continue;
        seenLost.add(dedupeKey);
        lostCounts.set(key, (lostCounts.get(key) ?? 0) + 1);
      }
    }
  } else {
    const deals = await prisma.deal.findMany({
      where: closedWhere,
      select: {
        outcome: true,
        lossReasonNote: true,
        lossReason: { select: { name: true } },
        siteCity: true,
        account: { select: { city: true, customerProfile: { select: { name: true } } } },
      },
    });

    for (const d of deals) {
      const segment = dimension === "sector" ? d.account.customerProfile?.name ?? "(unclassified)" : resolveCity(d);
      if (d.outcome === "WON") {
        wonCounts.set(segment, (wonCounts.get(segment) ?? 0) + 1);
      } else {
        const key = `${segment}|${reasonFor(d)}`;
        lostCounts.set(key, (lostCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // One row per segment/reason pairing that actually lost deals — a
  // segment/reason pairing needs both numbers to be useful, so wonCount is
  // looked up from the SAME segment's won total rather than re-derived.
  const rows: WinLossSegmentRow[] = [...lostCounts.entries()].map(([key, lostCount]) => {
    const [segmentLabel, reasonName] = key.split("|");
    return { segmentLabel, reasonName, wonCount: wonCounts.get(segmentLabel) ?? 0, lostCount };
  });

  return rows.sort((a, b) => b.lostCount - a.lostCount || b.wonCount - a.wonCount);
}
