// Product movement + conversion analytics (spec §7.3). Reads DealLineItem,
// which Phase 2 (real, quotationId set) and the deal-creation "interested
// in" picker (enquiry-only, quotationId null) both populate — see §7.2's
// enquiry-vs-sale distinction this whole file exists to answer.
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { MIN_SAMPLE_SIZE } from "./types";

// Below this conversion rate (won/quoted), a product with enough quoted
// volume to be meaningful gets flagged. Spec says "flag high-enquiry,
// low-conversion products" without naming a number — this is a visible
// default, not a confirmed business threshold (same pattern as the stuck-deal
// SLA default in §8.2 — see docs/DATA_GAPS.md).
const LOW_CONVERSION_THRESHOLD = 0.2;

// Product tracking is scoped to flooring only, per explicit request. Most
// line items have no matched productId (rate-sheet category labels like
// "Artificial Turf for Multisports" — see Phase 4's DECISIONS.md entry), and
// 2 real catalogue products are actually mistyped as "flooring" despite
// being a lighting system and a netting product — so Product.type alone is
// unreliable in both directions. Match on the vocabulary Product.type's own
// schema comment defines flooring as (turf / acrylic / PPE tile / PVC
// surfaces), checked against whichever text is available: the line's own
// label, or its matched product's name.
const FLOORING_KEYWORDS = /turf|flooring|acrylic|\bpvc\b|ppe.?tile/i;
function isFlooringLine(li: { label: string | null; product: { name: string } | null }): boolean {
  return FLOORING_KEYWORDS.test([li.label, li.product?.name].filter(Boolean).join(" "));
}

export type ProductMovementRow = {
  month: string; // "YYYY-MM"
  productName: string; // "(unspecified)" for line items with no matched Product
  enquiries: number;
  quoted: number;
  quotedValue: number;
  won: number;
  wonValue: number;
};

export type ProductCityCell = { productName: string; city: string; wonValue: number; enquiries: number };
export type ProductSegmentCell = { productName: string; profileName: string; enquiries: number };

export type ProductConversionRow = {
  productName: string;
  enquiries: number;
  quoted: number;
  won: number;
  conversionRate: number | null; // won / quoted, null if quoted < MIN_SAMPLE_SIZE
  flagged: boolean;
};

export type ProductAnalytics = {
  movement: ProductMovementRow[];
  cityHeatmap: ProductCityCell[];
  segmentMatrix: ProductSegmentCell[];
  conversion: ProductConversionRow[];
  // Seasonality (spec §7.3.6) needs >=2 distinct calendar years of Deal
  // history to overlay meaningfully — until then this list has <2 entries
  // and the UI shows "needs more history" instead of a misleading chart.
  distinctYears: number[];
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function productAnalytics(filter: AnalyticsFilter): Promise<ProductAnalytics> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};

  const allLineItems = await prisma.dealLineItem.findMany({
    where: {
      deal: { deletedAt: null, ...ownerWhere },
      // Perf: narrow to line items that can actually affect this window on
      // at least one of the 3 signals read below (enquiry/quoted/won) —
      // previously this had no date bound at all and re-fetched every
      // DealLineItem ever created on every call, growing forever regardless
      // of the selected range (see docs/DECISIONS.md perf note). A row
      // matching none of these branches contributes nothing to any of the
      // maps built below, so this is a pure narrowing of the fetch, not a
      // behavior change — verified by diffing full output before/after on
      // live data.
      OR: [
        { deal: { enquiryAt: { gte: filter.from, lte: filter.to } } },
        { quotation: { sentAt: { gte: filter.from, lte: filter.to } } },
        { deal: { outcome: "WON", closedAt: { gte: filter.from, lte: filter.to } } },
      ],
    },
    select: {
      amount: true,
      quotationId: true,
      quotation: { select: { sentAt: true, isPrimary: true } },
      label: true,
      product: { select: { name: true } },
      deal: {
        select: {
          id: true,
          enquiryAt: true,
          outcome: true,
          closedAt: true,
          siteCity: true,
          account: { select: { customerProfile: { select: { name: true } } } },
        },
      },
    },
  });
  const lineItems = allLineItems.filter(isFlooringLine);

  // --- Movement over time: enquiries (distinct deals), quoted, won ---
  const movementMap = new Map<string, { enquiries: Set<string>; quoted: number; quotedValue: number; won: number; wonValue: number }>();
  // --- City heatmap + segment matrix accumulate on won/enquiry signals ---
  const cityMap = new Map<string, { wonValue: number; enquiries: Set<string> }>();
  const segmentMap = new Map<string, Set<string>>();
  // --- Conversion: quoted vs won per product, all-time within filter ---
  const conversionMap = new Map<string, { enquiries: Set<string>; quoted: number; won: number }>();
  const years = new Set<number>();

  for (const li of lineItems) {
    // Quote line items are usually named from the rate-sheet cost category
    // (e.g. "Fencing", "Artificial Turf for Multisports"), not the curated
    // Product catalogue — productId is only set when a rep explicitly picks
    // a specific catalogue SKU for a line. Group by that label so the same
    // cost category rolls up consistently even without a picked product.
    const productName = li.product?.name ?? li.label ?? "(unspecified)";
    const amount = li.amount ? Number(li.amount) : 0;

    // Enquiry signal: this deal's enquiryAt, regardless of isEnquiryOnly —
    // per spec §7.2, ANY line item counts toward enquiry volume.
    if (li.deal.enquiryAt >= filter.from && li.deal.enquiryAt <= filter.to) {
      years.add(li.deal.enquiryAt.getFullYear());
      const key = `${monthKey(li.deal.enquiryAt)}|${productName}`;
      const m = movementMap.get(key) ?? { enquiries: new Set(), quoted: 0, quotedValue: 0, won: 0, wonValue: 0 };
      m.enquiries.add(li.deal.id);
      movementMap.set(key, m);

      const city = li.deal.siteCity?.trim() || "(unspecified)";
      const cKey = `${productName}|${city}`;
      const cEntry = cityMap.get(cKey) ?? { wonValue: 0, enquiries: new Set() };
      cEntry.enquiries.add(li.deal.id);
      cityMap.set(cKey, cEntry);

      const profile = li.deal.account.customerProfile?.name ?? "(unclassified)";
      const sKey = `${productName}|${profile}`;
      const sEntry = segmentMap.get(sKey) ?? new Set();
      sEntry.add(li.deal.id);
      segmentMap.set(sKey, sEntry);

      const cv = conversionMap.get(productName) ?? { enquiries: new Set(), quoted: 0, won: 0 };
      cv.enquiries.add(li.deal.id);
      conversionMap.set(productName, cv);
    }

    // Quoted signal: this line item's quotation was actually sent.
    if (li.quotationId && li.quotation?.sentAt && li.quotation.sentAt >= filter.from && li.quotation.sentAt <= filter.to) {
      const key = `${monthKey(li.quotation.sentAt)}|${productName}`;
      const m = movementMap.get(key) ?? { enquiries: new Set(), quoted: 0, quotedValue: 0, won: 0, wonValue: 0 };
      m.quoted += 1;
      m.quotedValue += amount;
      movementMap.set(key, m);

      const cv = conversionMap.get(productName) ?? { enquiries: new Set(), quoted: 0, won: 0 };
      cv.quoted += 1;
      conversionMap.set(productName, cv);
    }

    // Won signal: line item on the primary quotation of a WON deal.
    if (li.deal.outcome === "WON" && li.quotation?.isPrimary && li.deal.closedAt && li.deal.closedAt >= filter.from && li.deal.closedAt <= filter.to) {
      const key = `${monthKey(li.deal.closedAt)}|${productName}`;
      const m = movementMap.get(key) ?? { enquiries: new Set(), quoted: 0, quotedValue: 0, won: 0, wonValue: 0 };
      m.won += 1;
      m.wonValue += amount;
      movementMap.set(key, m);

      const city = li.deal.siteCity?.trim() || "(unspecified)";
      const cKey = `${productName}|${city}`;
      const cEntry = cityMap.get(cKey) ?? { wonValue: 0, enquiries: new Set() };
      cEntry.wonValue += amount;
      cityMap.set(cKey, cEntry);

      const cv = conversionMap.get(productName) ?? { enquiries: new Set(), quoted: 0, won: 0 };
      cv.won += 1;
      conversionMap.set(productName, cv);
    }
  }

  const movement: ProductMovementRow[] = [...movementMap.entries()]
    .map(([key, v]) => {
      const [month, productName] = key.split("|");
      return {
        month,
        productName,
        enquiries: v.enquiries.size,
        quoted: v.quoted,
        quotedValue: v.quotedValue,
        won: v.won,
        wonValue: v.wonValue,
      };
    })
    .sort((a, b) => (a.month === b.month ? a.productName.localeCompare(b.productName) : a.month.localeCompare(b.month)));

  const cityHeatmap: ProductCityCell[] = [...cityMap.entries()].map(([key, v]) => {
    const [productName, city] = key.split("|");
    return { productName, city, wonValue: v.wonValue, enquiries: v.enquiries.size };
  });

  const segmentMatrix: ProductSegmentCell[] = [...segmentMap.entries()].map(([key, deals]) => {
    const [productName, profileName] = key.split("|");
    return { productName, profileName, enquiries: deals.size };
  });

  const conversion: ProductConversionRow[] = [...conversionMap.entries()]
    .map(([productName, v]) => {
      const conversionRate = v.quoted >= MIN_SAMPLE_SIZE ? v.won / v.quoted : null;
      return {
        productName,
        enquiries: v.enquiries.size,
        quoted: v.quoted,
        won: v.won,
        conversionRate,
        flagged: conversionRate != null && conversionRate < LOW_CONVERSION_THRESHOLD && v.enquiries.size >= MIN_SAMPLE_SIZE,
      };
    })
    .sort((a, b) => b.enquiries - a.enquiries);

  return { movement, cityHeatmap, segmentMatrix, conversion, distinctYears: [...years].sort() };
}
