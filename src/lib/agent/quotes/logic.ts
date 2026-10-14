import { computeAreaForItem, recompute, type QuoteLineItem, type QuoteTotals } from "@/lib/quotation/calculator";
import type { RateSheetItem } from "@/lib/quotation/rates";
import { sectionForItem } from "@/lib/quotation/sections";
import { defaultUnitForAreaMode } from "@/lib/quotation/units";
import { hashCanonical } from "../canonical";
import { AgentHttpError } from "../errors";

/**
 * Pure rules for the AI's quotes. Nothing here touches the database.
 *
 * The one rule everything hangs on: the AI never supplies a price. A line's
 * rate and GST come from the rate sheet (getRatesForSport), its quantity from
 * the plot size (computeAreaForItem) or the caller's piece count, and every
 * total from recompute(). The only way a rate on a quote ever differs from the
 * sheet is an approved discount (applyDiscount), which a person signs off on.
 */

export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
/** A discount larger than this is refused outright, even before a person sees it. */
export const MAX_DISCOUNT_PERCENT = 50;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const bad = (message: string, status?: number) => new AgentHttpError("invalid_input", message, status);

// ---- the caller's wishes -----------------------------------------------------

export type ItemPatch = { rateItemId: string; quantity?: number; included?: boolean };
export type ItemSetting = { quantity?: number; included?: boolean };
export type ItemSettings = Map<string, ItemSetting>;

/**
 * Check what the caller named against the rate sheet and fold it over `base`
 * (settings carried over from an existing quote; empty for a new one).
 * Naming an item adds it unless `included: false`. Returns the settings and the
 * set of ids the caller named.
 */
export function resolveItemSettings(args: {
  sheet: RateSheetItem[];
  patches: ItemPatch[] | undefined;
  base?: ItemSettings;
}): { settings: ItemSettings; named: Set<string> } {
  const byId = new Map(args.sheet.map((i) => [i.id, i]));
  const settings: ItemSettings = new Map(args.base ? [...args.base].map(([k, v]) => [k, { ...v }]) : []);
  const named = new Set<string>();
  const unknown: string[] = [];
  const repeated: string[] = [];
  const badQuantity: string[] = [];

  for (const p of args.patches ?? []) {
    const item = byId.get(p.rateItemId);
    if (!item) {
      unknown.push(p.rateItemId);
      continue;
    }
    if (named.has(p.rateItemId)) {
      repeated.push(p.rateItemId);
      continue;
    }
    named.add(p.rateItemId);
    if (p.quantity !== undefined && item.areaMode !== "per_piece") badQuantity.push(p.rateItemId);
    const next: ItemSetting = { ...settings.get(p.rateItemId) };
    if (p.quantity !== undefined) next.quantity = p.quantity;
    next.included = p.included ?? true;
    settings.set(p.rateItemId, next);
  }

  if (unknown.length) {
    throw bad(`Unknown rate item(s): ${unknown.join(", ")}. Valid ids: ${args.sheet.map((i) => i.id).join(", ")}.`);
  }
  if (repeated.length) throw bad(`Rate item listed more than once: ${repeated.join(", ")}.`);
  if (badQuantity.length) throw bad(`quantity only applies to per-piece items: ${badQuantity.join(", ")}.`);
  return { settings, named };
}

// ---- building lines from the rate sheet --------------------------------------

function assertSheetItemIsPriceable(item: RateSheetItem): void {
  const rate = item.defaultRate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    throw bad(`The rate sheet has an invalid rate for "${item.name}". A person must fix the rate sheet first.`, 422);
  }
  const gst = item.gstPercent;
  if (typeof gst !== "number" || !Number.isFinite(gst) || gst < 0 || gst > 100) {
    throw bad(`The rate sheet has an invalid GST for "${item.name}". A person must fix the rate sheet first.`, 422);
  }
}

export type BuiltQuote = { lines: QuoteLineItem[]; totals: QuoteTotals; warnings: string[] };

/**
 * Every sheet item becomes a line (as the quotation wizard does), included or
 * not. Default scope is the sheet's non-optional items. A per-piece item that
 * is included without a quantity is refused when the caller named it, and left
 * out with a warning when it only came from the default scope.
 */
export function buildQuoteLines(args: {
  sheet: RateSheetItem[];
  lengthFt: number;
  widthFt: number;
  settings: ItemSettings;
  named: Set<string>;
}): BuiltQuote {
  const { sheet, lengthFt, widthFt } = args;
  if (!Number.isInteger(lengthFt) || !Number.isInteger(widthFt) || lengthFt < 1 || widthFt < 1) {
    throw bad("lengthFt and widthFt must be whole numbers of at least 1.");
  }
  const warnings: string[] = [];
  const lines: QuoteLineItem[] = [];

  for (const item of sheet) {
    assertSheetItemIsPriceable(item);
    const s = args.settings.get(item.id);
    let included = s ? (s.included ?? true) : !item.optional;
    const perPiece = item.areaMode === "per_piece";
    const qty = perPiece ? (s?.quantity ?? 0) : 0;
    if (included && perPiece && !(qty > 0)) {
      if (args.named.has(item.id)) throw bad(`"${item.name}" is priced per piece: send a quantity (1 or more) for ${item.id}.`);
      included = false;
      warnings.push(`"${item.name}" is priced per piece and has no quantity, so it is left out. Add it with a quantity.`);
    }
    const area = computeAreaForItem(item, lengthFt, widthFt, qty);
    lines.push({
      id: item.id,
      name: item.name,
      description: item.description,
      areaSqFt: area,
      unit: item.unit ?? defaultUnitForAreaMode(item.areaMode),
      ratePerSqFt: item.defaultRate,
      gstPercent: item.gstPercent,
      total: area * item.defaultRate,
      included,
      section: sectionForItem(item),
      qtyDim1: item.areaMode === "plot" ? lengthFt : undefined,
      qtyDim2: item.areaMode === "plot" ? widthFt : undefined,
    });
  }

  return { lines, totals: assertPriceable(lines), warnings };
}

/**
 * Last line of defence before a quote is saved or sent: no negative rate or
 * quantity, no GST outside 0-100, and a total above zero. Returns the totals.
 */
export function assertPriceable(lines: QuoteLineItem[]): QuoteTotals {
  for (const l of lines) {
    if (!l.included) continue;
    if (!Number.isFinite(l.ratePerSqFt) || l.ratePerSqFt < 0) throw bad(`"${l.name}" has a negative or invalid rate.`, 422);
    if (!Number.isFinite(l.areaSqFt) || l.areaSqFt < 0) throw bad(`"${l.name}" has a negative or invalid quantity.`, 422);
    if (!Number.isFinite(l.gstPercent) || l.gstPercent < 0 || l.gstPercent > 100) throw bad(`"${l.name}" has an invalid GST.`, 422);
  }
  const totals = recompute(lines);
  if (!(totals.grandTotal > 0)) {
    throw bad("The quotation would have a zero total. Include at least one priced item (and a quantity for per-piece items).", 422);
  }
  return totals;
}

export function parseStoredLines(json: string | null | undefined): QuoteLineItem[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as QuoteLineItem[]) : [];
  } catch {
    return [];
  }
}

/** Settings carried over from a saved quote: which lines are in, and the piece counts. */
export function settingsFromLines(lines: QuoteLineItem[], sheet: RateSheetItem[]): ItemSettings {
  const byId = new Map(sheet.map((i) => [i.id, i]));
  const out: ItemSettings = new Map();
  for (const l of lines) {
    const item = byId.get(l.id);
    if (!item) continue;
    out.set(l.id, {
      included: !!l.included,
      ...(item.areaMode === "per_piece" && l.included && l.areaSqFt > 0 ? { quantity: l.areaSqFt } : {}),
    });
  }
  return out;
}

/** Saved lines whose item is no longer on the rate sheet: they cannot be re-priced and are dropped. */
export function droppedLineWarnings(lines: QuoteLineItem[], sheet: RateSheetItem[]): string[] {
  const ids = new Set(sheet.map((i) => i.id));
  return lines.filter((l) => l.included && !ids.has(l.id)).map((l) => `"${l.name}" is no longer on the rate sheet and was removed.`);
}

// ---- content hash (dedupe and approval) ---------------------------------------

/**
 * Fingerprint of what a customer would pay for: the plot, the priced lines, the
 * notes and the validity. Used to spot the same draft created twice and to make
 * sure the quote a person approved is the quote that gets sent.
 */
export function quoteContentHash(q: {
  sport: string;
  lengthFt: number;
  widthFt: number;
  lines: QuoteLineItem[];
  notes: string | null | undefined;
  validityDays: number;
}): string {
  const lines = q.lines
    .filter((l) => l.included)
    .map((l) => ({ id: l.id, qty: round2(l.areaSqFt), rate: round2(l.ratePerSqFt), gst: l.gstPercent }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hashCanonical({
    sport: q.sport,
    lengthFt: q.lengthFt,
    widthFt: q.widthFt,
    notes: q.notes?.trim() || null,
    validityDays: q.validityDays,
    lines,
  }).slice(0, 32);
}

// ---- stages --------------------------------------------------------------------

export type ApprovalState = "none" | "pending" | "approved" | "rejected";
/**
 * Where a quote is in its life. "estimate" (stage 1, nothing saved) is never a
 * quote; a "draft" is the AI's proposal; only "approved" (a person signed it
 * off) may be sent to a customer.
 */
export type QuoteStage = "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "closed";

export function quoteStage(q: { status: string; approvalState: string }): QuoteStage {
  switch (q.status) {
    case "sent":
    case "viewed":
      return "sent";
    case "accepted":
      return "accepted";
    case "rejected":
    case "expired":
    case "superseded":
      return "closed";
    default:
      if (q.approvalState === "approved") return "approved";
      if (q.approvalState === "pending") return "pending_approval";
      return "draft";
  }
}

export const DRAFT_NOTICE =
  "DRAFT: a person has not approved this quotation. Do not give the customer this price as final; submit it for approval first.";
export const PENDING_NOTICE = "WAITING FOR APPROVAL: a person is reviewing this quotation. Do not give the customer this price as final.";

export function noticeFor(q: { status: string; approvalState: string }): string | null {
  if (q.approvalState === "approved") return null;
  return q.approvalState === "pending" ? PENDING_NOTICE : DRAFT_NOTICE;
}

/** Statuses a quote can still be sent from. */
export const SENDABLE_STATUSES = ["draft", "sent", "viewed"] as const;

// ---- stored quotes: consistency ----------------------------------------------

/** Do the saved totals still equal the saved lines? (A person editing the row by hand could break this.) */
export function totalsMatchLines(q: { lines: QuoteLineItem[]; subtotal: number; gstAmount: number; grandTotal: number }): boolean {
  const t = recompute(q.lines);
  return Math.abs(t.grandTotal - q.grandTotal) < 0.01 && Math.abs(t.subtotal - q.subtotal) < 0.01 && Math.abs(t.gstAmount - q.gstAmount) < 0.01;
}

// ---- discounts ---------------------------------------------------------------

export type DiscountSpec = { lines: { rateItemId: string; requestedRate: number }[] } | { percent: number };
export type DiscountChange = { rateItemId: string; name: string; from: number; to: number };

/** Thrown when an approved discount cannot be applied as written; nothing is created. */
export class DiscountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountError";
  }
}

/**
 * Apply an approved discount to a copy of the quote's lines. Only the named
 * lines (or, for a percentage, the included ones) change, and only DOWNWARDS:
 * a rate that is not below the current one, a rate at or below zero, or a cut
 * beyond MAX_DISCOUNT_PERCENT is refused. Totals come from recompute().
 */
export function applyDiscount(
  lines: QuoteLineItem[],
  spec: DiscountSpec,
): { lines: QuoteLineItem[]; changes: DiscountChange[]; totals: QuoteTotals } {
  const before = recompute(lines);
  const next = lines.map((l) => ({ ...l }));
  const changes: DiscountChange[] = [];
  const floor = (rate: number) => rate * (1 - MAX_DISCOUNT_PERCENT / 100);

  const setRate = (l: QuoteLineItem, to: number) => {
    if (!Number.isFinite(to) || to <= 0) throw new DiscountError(`"${l.name}": the discounted rate must be above zero.`);
    if (!(to < l.ratePerSqFt)) throw new DiscountError(`"${l.name}": ${to} is not below the current rate ${l.ratePerSqFt}. A discount can only lower a rate.`);
    if (to < round2(floor(l.ratePerSqFt))) {
      throw new DiscountError(`"${l.name}": a discount above ${MAX_DISCOUNT_PERCENT}% is not allowed.`);
    }
    changes.push({ rateItemId: l.id, name: l.name, from: l.ratePerSqFt, to });
    l.ratePerSqFt = to;
    l.total = l.areaSqFt * to;
  };

  if ("percent" in spec) {
    if (!(spec.percent > 0) || spec.percent > MAX_DISCOUNT_PERCENT) {
      throw new DiscountError(`The discount must be above 0% and at most ${MAX_DISCOUNT_PERCENT}%.`);
    }
    for (const l of next) {
      if (!l.included || !(l.ratePerSqFt > 0)) continue;
      const to = round2(l.ratePerSqFt * (1 - spec.percent / 100));
      // A tiny rate can round back to itself (or to zero): leave that line alone.
      if (!(to > 0) || !(to < l.ratePerSqFt)) continue;
      setRate(l, to);
    }
  } else {
    const byId = new Map(next.map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const r of spec.lines) {
      if (seen.has(r.rateItemId)) throw new DiscountError(`Rate item listed more than once: ${r.rateItemId}.`);
      seen.add(r.rateItemId);
      const l = byId.get(r.rateItemId);
      if (!l) throw new DiscountError(`The quotation has no line "${r.rateItemId}".`);
      if (!l.included) throw new DiscountError(`"${l.name}" is not included in the quotation, so it cannot be discounted.`);
      setRate(l, round2(r.requestedRate));
    }
  }

  if (changes.length === 0) throw new DiscountError("The discount changes nothing.");
  const totals = recompute(next);
  if (!(totals.grandTotal > 0)) throw new DiscountError("The discounted quotation would have a zero total.");
  if (!(totals.grandTotal < before.grandTotal)) throw new DiscountError("The discounted total is not below the current total.");
  return { lines: next, changes, totals };
}
