import { beforeEach, describe, expect, it, vi } from "vitest";

const settingFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { setting: { findUnique: (...a: unknown[]) => settingFindUnique(...a) } },
}));

import { buildInitialLineItems, recompute } from "@/lib/quotation/calculator";
import { BASKETBALL_DEFAULTS, FOOTBALL_DEFAULTS, type RateSheetItem } from "@/lib/quotation/rates";
import { AgentHttpError } from "../errors";
import { ESTIMATE_DISCLAIMER, buildEstimate, estimatePrice, getRateSheet } from "../read/pricing";

const base = { sport: "football" as const, sheet: FOOTBALL_DEFAULTS, source: "built_in_defaults" as const };

function expectInvalid(fn: () => unknown, match: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AgentHttpError);
    expect((e as AgentHttpError).code).toBe("invalid_input");
    expect((e as AgentHttpError).status).toBe(400);
    expect((e as AgentHttpError).message).toMatch(match);
    return;
  }
  throw new Error("expected an AgentHttpError");
}

describe("buildEstimate: known football 100 x 60 ft", () => {
  // area 6000 sq.ft; net wrap = (100+60)*2*35 + 6000 = 17200 sq.ft
  const est = buildEstimate({ ...base, lengthFt: 100, widthFt: 60 });

  it("prices the default scope line by line", () => {
    const byId = Object.fromEntries(est.lines.map((l) => [l.rateItemId, l]));
    expect(Object.keys(byId)).toEqual(["sub_base", "turf", "nylon_net", "fencing", "lightings"]);
    expect(byId.sub_base).toMatchObject({ quantity: 6000, ratePerUnit: 75, amount: 450_000, gstAmount: 22_500, unit: "sq.ft" });
    expect(byId.turf).toMatchObject({ quantity: 6000, ratePerUnit: 112, amount: 672_000, gstAmount: 33_600 });
    expect(byId.nylon_net).toMatchObject({ quantity: 17_200, ratePerUnit: 12, amount: 206_400, gstAmount: 10_320 });
    expect(byId.fencing).toMatchObject({ amount: 420_000, gstAmount: 75_600, gstPercent: 18 });
    expect(byId.lightings).toMatchObject({ amount: 198_000, gstAmount: 35_640 });
  });

  it("totals subtotal, GST and total", () => {
    expect(est.subtotal).toBe(1_946_400);
    expect(est.gst).toBe(177_660);
    expect(est.total).toBe(2_124_060);
    expect(est.plotAreaSqFt).toBe(6000);
  });

  it("is labelled an estimate from the built-in sheet, with a disclaimer", () => {
    expect(est.kind).toBe("estimate");
    expect(est.priceSource).toBe("built_in_defaults");
    expect(est.currency).toBe("INR");
    expect(est.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    expect(est.disclaimer).toMatch(/not a quotation/i);
    expect(est.warnings).toEqual([]);
  });

  it("matches the quotation calculator exactly", () => {
    const sheetLines = buildInitialLineItems(FOOTBALL_DEFAULTS, 100, 60);
    const totals = recompute(sheetLines);
    expect(est.subtotal).toBe(totals.subtotal);
    expect(est.gst).toBe(totals.gstAmount);
    expect(est.total).toBe(totals.grandTotal);
  });

  it("lists the optional items it left out", () => {
    expect(est.optionalItems.map((o) => o.rateItemId)).toEqual(["chemical_treatment", "padding"]);
  });
});

describe("buildEstimate: item choices", () => {
  it("adds an optional item by naming it", () => {
    const est = buildEstimate({ ...base, lengthFt: 100, widthFt: 60, items: [{ rateItemId: "chemical_treatment" }] });
    const line = est.lines.find((l) => l.rateItemId === "chemical_treatment")!;
    expect(line).toMatchObject({ quantity: 6000, ratePerUnit: 1, amount: 6000, gstAmount: 1080 });
    expect(est.subtotal).toBe(1_946_400 + 6000);
    expect(est.optionalItems.map((o) => o.rateItemId)).toEqual(["padding"]);
  });

  it("removes a default item with included:false", () => {
    const est = buildEstimate({ ...base, lengthFt: 100, widthFt: 60, items: [{ rateItemId: "fencing", included: false }] });
    expect(est.lines.map((l) => l.rateItemId)).not.toContain("fencing");
    expect(est.subtotal).toBe(1_946_400 - 420_000);
  });

  it("prices a per-piece item from the quantity given", () => {
    const est = buildEstimate({ ...base, lengthFt: 100, widthFt: 60, items: [{ rateItemId: "padding", quantity: 4 }] });
    expect(est.lines.find((l) => l.rateItemId === "padding")).toMatchObject({ unit: "qty", quantity: 4, amount: 6000, gstAmount: 1080 });
  });

  it("warns, rather than silently pricing, a per-piece item with no quantity", () => {
    const est = buildEstimate({
      sport: "basketball",
      sheet: BASKETBALL_DEFAULTS,
      source: "admin_rate_sheet",
      lengthFt: 94,
      widthFt: 50,
    });
    expect(est.priceSource).toBe("admin_rate_sheet");
    expect(est.warnings.some((w) => /Basketball Movable Post/.test(w) && /counted as 0/.test(w))).toBe(true);
    expect(est.lines.find((l) => l.rateItemId === "basketball_post")).toMatchObject({ quantity: 0, amount: 0 });
  });

  it("uses running feet for perimeter items", () => {
    const sheet: RateSheetItem[] = [
      { id: "edge", name: "Edge wall", description: "", areaMode: "perimeter", defaultRate: 350, gstPercent: 18 },
    ];
    const est = buildEstimate({ ...base, sheet, lengthFt: 78, widthFt: 36, items: undefined });
    expect(est.lines[0]).toMatchObject({ unit: "rft", quantity: 228, amount: 79_800, gstAmount: 14_364 });
    expect(est.total).toBe(94_164);
  });

  it("rounds to paise", () => {
    const sheet: RateSheetItem[] = [{ id: "a", name: "A", description: "", areaMode: "plot", defaultRate: 33.333, gstPercent: 18 }];
    const est = buildEstimate({ ...base, sheet, lengthFt: 10.5, widthFt: 7.25 });
    expect(est.total).toBe(Math.round(est.total * 100) / 100);
    expect(est.subtotal).toBe(recompute(buildInitialLineItems(sheet, 10.5, 7.25)).subtotal);
  });
});

describe("buildEstimate: clear errors", () => {
  it("rejects unknown rate items and lists the valid ones", () => {
    expectInvalid(
      () => buildEstimate({ ...base, lengthFt: 10, widthFt: 10, items: [{ rateItemId: "gold_plating" }] }),
      /Unknown rate item\(s\) for football: gold_plating\. Valid ids: chemical_treatment, sub_base, turf/,
    );
  });

  it("rejects the same item twice", () => {
    expectInvalid(
      () => buildEstimate({ ...base, lengthFt: 10, widthFt: 10, items: [{ rateItemId: "turf" }, { rateItemId: "turf", included: false }] }),
      /more than once: turf/,
    );
  });

  it("rejects a quantity on an item that is not per-piece", () => {
    expectInvalid(
      () => buildEstimate({ ...base, lengthFt: 10, widthFt: 10, items: [{ rateItemId: "turf", quantity: 3 }] }),
      /per-piece items: turf/,
    );
  });

  it("rejects non-positive dimensions even if the schema was skipped", () => {
    expectInvalid(() => buildEstimate({ ...base, lengthFt: 0, widthFt: 10 }), /greater than 0/);
    expectInvalid(() => buildEstimate({ ...base, lengthFt: 10, widthFt: -2 }), /greater than 0/);
    expectInvalid(() => buildEstimate({ ...base, lengthFt: Number.NaN, widthFt: 10 }), /greater than 0/);
  });
});

describe("the rate comes from the sheet only", () => {
  beforeEach(() => settingFindUnique.mockReset());

  it("uses the admin sheet when the setting row parses, and says so", async () => {
    const custom: RateSheetItem[] = [
      { id: "turf", name: "Turf", description: "d", areaMode: "plot", defaultRate: 200, gstPercent: 5 },
    ];
    settingFindUnique.mockResolvedValue({ key: "quotation_football_rates", value: JSON.stringify(custom) });
    const est = await estimatePrice({ sport: "football", lengthFt: 10, widthFt: 10 });
    expect(est.priceSource).toBe("admin_rate_sheet");
    expect(est.lines).toHaveLength(1);
    expect(est.lines[0]).toMatchObject({ ratePerUnit: 200, amount: 20_000, gstAmount: 1000 });
    expect(est.total).toBe(21_000);
    expect(settingFindUnique).toHaveBeenCalledWith({ where: { key: "quotation_football_rates" } });
  });

  it("falls back to the built-in defaults when there is no row", async () => {
    settingFindUnique.mockResolvedValue(null);
    const est = await estimatePrice({ sport: "football", lengthFt: 100, widthFt: 60 });
    expect(est.priceSource).toBe("built_in_defaults");
    expect(est.total).toBe(2_124_060);
  });
});

describe("getRateSheet source", () => {
  beforeEach(() => settingFindUnique.mockReset());

  it("reports built_in_defaults when the row is missing", async () => {
    settingFindUnique.mockResolvedValue(null);
    const sheet = await getRateSheet("tennis");
    expect(sheet).toMatchObject({ sport: "tennis", currency: "INR", source: "built_in_defaults" });
    expect(sheet.items.length).toBeGreaterThan(0);
    expect(sheet.items[0]).toEqual(
      expect.objectContaining({ id: "tennis_chemical", ratePerUnit: 3, gstPercent: 18, optional: true, unit: "sq.ft" }),
    );
  });

  it("reports built_in_defaults when the row is malformed or empty", async () => {
    for (const value of ["not json", "[]", "{}", "null"]) {
      settingFindUnique.mockResolvedValue({ key: "k", value });
      expect((await getRateSheet("tennis")).source, value).toBe("built_in_defaults");
    }
  });

  it("reports admin_rate_sheet when the row parses", async () => {
    settingFindUnique.mockResolvedValue({
      key: "k",
      value: JSON.stringify([{ id: "x", name: "X", description: "", areaMode: "plot", defaultRate: 9, gstPercent: 18 }]),
    });
    const sheet = await getRateSheet("tennis");
    expect(sheet.source).toBe("admin_rate_sheet");
    expect(sheet.items.map((i) => i.id)).toEqual(["x"]);
  });
});
