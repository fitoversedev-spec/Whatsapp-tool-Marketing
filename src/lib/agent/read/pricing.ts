import { computeAreaForItem, recompute, type QuoteLineItem } from "@/lib/quotation/calculator";
import { getRatesForSportWithSource, type RateSheetItem, type Sport } from "@/lib/quotation/rates";
import { defaultUnitForAreaMode } from "@/lib/quotation/units";
import { AgentHttpError } from "../errors";
import type { EstimateInput, EstimateResponse } from "../schemas/read";

/**
 * Rate sheet and price estimate. The AI never supplies a rate: every figure
 * comes from the sheet (admin-edited, or the built-in defaults) and the shared
 * quotation calculator. Nothing is saved.
 */

export const ESTIMATE_DISCLAIMER =
  "Indicative estimate from the standard Fitoverse rate sheet. This is not a quotation; final pricing, scope and taxes are confirmed by the Fitoverse team.";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function toAgentRateItem(i: RateSheetItem) {
  return {
    id: i.id,
    name: i.name,
    description: i.description,
    section: i.section ?? null,
    areaMode: i.areaMode,
    unit: i.unit ?? defaultUnitForAreaMode(i.areaMode),
    ratePerUnit: i.defaultRate,
    gstPercent: i.gstPercent,
    optional: !!i.optional,
  };
}

export async function getRateSheet(sport: Sport) {
  const { items, source } = await getRatesForSportWithSource(sport);
  return { sport, currency: "INR" as const, source, items: items.map(toAgentRateItem) };
}

/**
 * Pure: price a plot from a rate sheet. Throws a 400 AgentHttpError for items
 * that are not on the sheet, repeated items, or a quantity on a non-per-piece item.
 */
export function buildEstimate(args: {
  sport: Sport;
  sheet: RateSheetItem[];
  source: "admin_rate_sheet" | "built_in_defaults";
  lengthFt: number;
  widthFt: number;
  items?: EstimateInput["items"];
}): EstimateResponse {
  const { sport, sheet, source, lengthFt, widthFt } = args;
  if (!(lengthFt > 0) || !(widthFt > 0)) {
    throw new AgentHttpError("invalid_input", "lengthFt and widthFt must be greater than 0.");
  }
  const byId = new Map(sheet.map((i) => [i.id, i]));

  const overrides = new Map<string, { quantity?: number; included?: boolean }>();
  const unknown: string[] = [];
  const repeated: string[] = [];
  const badQuantity: string[] = [];
  for (const o of args.items ?? []) {
    const item = byId.get(o.rateItemId);
    if (!item) {
      unknown.push(o.rateItemId);
      continue;
    }
    if (overrides.has(o.rateItemId)) {
      repeated.push(o.rateItemId);
      continue;
    }
    if (o.quantity !== undefined && item.areaMode !== "per_piece") badQuantity.push(o.rateItemId);
    overrides.set(o.rateItemId, { quantity: o.quantity, included: o.included });
  }
  if (unknown.length) {
    throw new AgentHttpError(
      "invalid_input",
      `Unknown rate item(s) for ${sport}: ${unknown.join(", ")}. Valid ids: ${sheet.map((i) => i.id).join(", ")}.`,
    );
  }
  if (repeated.length) {
    throw new AgentHttpError("invalid_input", `Rate item listed more than once: ${repeated.join(", ")}.`);
  }
  if (badQuantity.length) {
    throw new AgentHttpError("invalid_input", `quantity only applies to per-piece items: ${badQuantity.join(", ")}.`);
  }

  const warnings: string[] = [];
  const lineItems: QuoteLineItem[] = [];
  const includedIds = new Set<string>();
  for (const item of sheet) {
    const o = overrides.get(item.id);
    // Default scope = the sheet's non-optional items; naming an item adds it unless included:false.
    const included = o ? (o.included ?? true) : !item.optional;
    if (!included) continue;
    includedIds.add(item.id);
    const qty = item.areaMode === "per_piece" ? (o?.quantity ?? 0) : 0;
    if (item.areaMode === "per_piece" && !(qty > 0)) {
      warnings.push(`"${item.name}" is priced per piece and no quantity was given, so it is counted as 0.`);
    }
    const area = computeAreaForItem(item, lengthFt, widthFt, qty);
    lineItems.push({
      id: item.id,
      name: item.name,
      description: "",
      areaSqFt: area,
      unit: item.unit ?? defaultUnitForAreaMode(item.areaMode),
      ratePerSqFt: item.defaultRate,
      gstPercent: item.gstPercent,
      total: area * item.defaultRate,
      included: true,
    });
  }

  const totals = recompute(lineItems);
  return {
    kind: "estimate",
    sport,
    lengthFt,
    widthFt,
    plotAreaSqFt: round2(lengthFt * widthFt),
    currency: "INR",
    lines: lineItems.map((l) => {
      const amount = l.areaSqFt * l.ratePerSqFt;
      return {
        rateItemId: l.id,
        name: l.name,
        unit: l.unit ?? "sq.ft",
        quantity: round2(l.areaSqFt),
        ratePerUnit: l.ratePerSqFt,
        gstPercent: l.gstPercent,
        amount: round2(amount),
        gstAmount: round2((amount * l.gstPercent) / 100),
      };
    }),
    optionalItems: sheet
      .filter((i) => i.optional && !includedIds.has(i.id))
      .map((i) => ({ rateItemId: i.id, name: i.name, areaMode: i.areaMode })),
    subtotal: totals.subtotal,
    gst: totals.gstAmount,
    total: totals.grandTotal,
    priceSource: source,
    warnings,
    disclaimer: ESTIMATE_DISCLAIMER,
  };
}

export async function estimatePrice(input: EstimateInput): Promise<EstimateResponse> {
  const { items: sheet, source } = await getRatesForSportWithSource(input.sport);
  return buildEstimate({
    sport: input.sport,
    sheet,
    source,
    lengthFt: input.lengthFt,
    widthFt: input.widthFt,
    items: input.items,
  });
}
