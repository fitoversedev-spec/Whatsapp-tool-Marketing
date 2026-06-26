// Quotation math. Pure functions — no DB, no side effects, easy to test.
//
// Area resolution per item type:
//   "plot"      → length × width
//   "wrap"      → (perimeter × wrapHeightFt) + (length × width)   ← walls + roof
//   "per_piece" → quantity (caller supplies via override)
//
// GST is per-item (some items are 5%, some 18%); we sum tax separately so
// the totals block can show the combined GST while individual items still
// reflect their own bracket.

import type { RateSheetItem } from "./rates";

export type QuoteLineItem = {
  id: string;
  name: string;
  description: string; // user-editable on the wizard
  areaSqFt: number;
  ratePerSqFt: number;
  gstPercent: number;
  total: number; // subtotal pre-GST
  included: boolean; // false = excluded from totals (e.g. Padding off)
  // For "per_piece" items, areaSqFt is the quantity (kept on the same field
  // for schema simplicity).
};

export function computeAreaForItem(
  item: RateSheetItem,
  lengthFt: number,
  widthFt: number,
  pieceQty = 0
): number {
  switch (item.areaMode) {
    case "plot":
      return lengthFt * widthFt;
    case "wrap": {
      const perimeter = (lengthFt + widthFt) * 2;
      const wallArea = perimeter * (item.wrapHeightFt ?? 35);
      const topArea = lengthFt * widthFt;
      return wallArea + topArea;
    }
    case "per_piece":
      return pieceQty;
  }
}

export function buildInitialLineItems(
  rateSheet: RateSheetItem[],
  lengthFt: number,
  widthFt: number
): QuoteLineItem[] {
  return rateSheet.map((r) => {
    const area = computeAreaForItem(r, lengthFt, widthFt, 0);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      areaSqFt: area,
      ratePerSqFt: r.defaultRate,
      gstPercent: r.gstPercent,
      total: area * r.defaultRate,
      included: !r.optional, // optional items (padding) start unchecked
    };
  });
}

export type QuoteTotals = {
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
};

export function recompute(items: QuoteLineItem[]): QuoteTotals {
  let subtotal = 0;
  let gstAmount = 0;
  for (const it of items) {
    if (!it.included) continue;
    const lineTotal = it.areaSqFt * it.ratePerSqFt;
    subtotal += lineTotal;
    gstAmount += (lineTotal * it.gstPercent) / 100;
  }
  return {
    subtotal: round2(subtotal),
    gstAmount: round2(gstAmount),
    grandTotal: round2(subtotal + gstAmount),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatINR(n: number): string {
  if (n === 0) return "₹ 0";
  // Indian-style grouping: 12,34,567
  return `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Sequential quotation number per calendar year. Caller passes the count
// of quotes already created this year (from prisma.quotation.count with a
// gte filter on Jan 1).
export function buildQuotationNumber(year: number, existingThisYear: number): string {
  const seq = String(existingThisYear + 1).padStart(3, "0");
  return `FIT-QT-${year}-${seq}`;
}
