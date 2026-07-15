// Quotation math. Pure functions — no DB, no side effects, easy to test.
//
// Area resolution per item type:
//   "plot"      → length × width
//   "wrap"      → (perimeter × wrapHeightFt) + (length × width)   ← walls + roof
//   "perimeter" → (length + width) × 2                            ← running feet
//   "per_piece" → quantity (caller supplies via override)
//
// GST is per-item (some items are 5%, some 18%); we sum tax separately so
// the totals block can show the combined GST while individual items still
// reflect their own bracket.

import { z } from "zod";
import type { RateSheetItem } from "./rates";
import { sectionForItem } from "./sections";
import { defaultUnitForAreaMode } from "./units";

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
  // Unit for the Area column — "sq.ft" (default) or "nos" for per-piece rows.
  // Without it, a per-piece qty like "1" renders as a bare number that reads
  // as 1 sq.ft in the PDF's Area column.
  unit?: string | null;
  // Optional product photo shown at the TOP of this item's description in the
  // PDF. Set from the wizard's "Products" step (auto-matched, reassignable).
  imageUrl?: string | null;
  // ── Optional presentation metadata (drives the reference quotation layout) ──
  // Section subheader the row groups under in the particulars table
  // (e.g. "A  Ground Preparation  (common to all options)"). Same value =
  // same group. Null/undefined = ungrouped.
  section?: string | null;
  // Mutually-exclusive option tag (e.g. "B1"). When any included items carry a
  // tag, the quote renders a "choose one option" comparison instead of a single
  // grand total, and each tagged row shows an option chip.
  optionTag?: string | null;
  optionColor?: "blue" | "green" | "red" | null; // chip colour
  optionShort?: string | null; // short label for comparison header / spec card
  // Structured specs for the "Specifications" cards (pile height, gauge, …).
  specs?: Array<{ label: string; value: string }> | null;
  // Which catalogue Product this line came from, if any (Phase 2 — was
  // previously computed in the wizard's product picker but dropped before
  // save; see docs/DECISIONS.md). Drives DealLineItem/product-movement
  // analytics. Historical line items predating this field are null.
  productId?: string | null;
};

// Single shared source of truth for both the POST (create) and PATCH
// (update) quotation routes — they used to each declare their own copy,
// which had silently drifted apart (PATCH was missing imageUrl/section/
// unit/specs, see docs/DECISIONS.md). Import this instead of redeclaring.
export const lineItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  areaSqFt: z.number().min(0).max(1_000_000),
  ratePerSqFt: z.number().min(0).max(1_000_000),
  gstPercent: z.number().min(0).max(100),
  total: z.number().min(0),
  included: z.boolean(),
  imageUrl: z.string().url().nullable().optional(),
  section: z.string().max(60).optional(),
  unit: z.string().max(20).nullable().optional(),
  // Structured product specs (from the Products step) → rendered as spec
  // cards after the quote table. Zod strips unknown keys, so without this the
  // specs would be silently dropped before the snapshot is stored.
  specs: z
    .array(z.object({ label: z.string().max(120), value: z.string().max(2000) }))
    .max(40)
    .nullable()
    .optional(),
  productId: z.string().uuid().nullable().optional(),
});

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
    case "perimeter":
      return (lengthFt + widthFt) * 2;
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
      unit: r.unit ?? defaultUnitForAreaMode(r.areaMode),
      ratePerSqFt: r.defaultRate,
      gstPercent: r.gstPercent,
      total: area * r.defaultRate,
      included: !r.optional, // optional items (padding) start unchecked
      section: sectionForItem(r),
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
