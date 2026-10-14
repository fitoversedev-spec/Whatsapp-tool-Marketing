import { describe, expect, it } from "vitest";
import { recompute, type QuoteLineItem } from "@/lib/quotation/calculator";
import type { RateSheetItem } from "@/lib/quotation/rates";
import { AgentHttpError } from "../errors";
import {
  applyDiscount,
  assertPriceable,
  buildQuoteLines,
  DiscountError,
  MAX_DISCOUNT_PERCENT,
  noticeFor,
  quoteContentHash,
  quoteStage,
  resolveItemSettings,
  settingsFromLines,
  totalsMatchLines,
} from "../quotes/logic";

const SHEET: RateSheetItem[] = [
  { id: "base", name: "Base", description: "d", areaMode: "plot", defaultRate: 100, gstPercent: 5 },
  { id: "turf", name: "Turf", description: "d", areaMode: "plot", defaultRate: 50, gstPercent: 18 },
  { id: "posts", name: "Posts", description: "d", areaMode: "per_piece", defaultRate: 2000, gstPercent: 18, optional: true },
  { id: "fence", name: "Fence", description: "d", areaMode: "perimeter", defaultRate: 10, gstPercent: 18, optional: true },
  { id: "net", name: "Net", description: "d", areaMode: "wrap", wrapHeightFt: 10, defaultRate: 12, gstPercent: 5, optional: true },
];

const build = (patches?: Parameters<typeof resolveItemSettings>[0]["patches"], length = 100, width = 50) => {
  const { settings, named } = resolveItemSettings({ sheet: SHEET, patches });
  return buildQuoteLines({ sheet: SHEET, lengthFt: length, widthFt: width, settings, named });
};

describe("totals always come from the rate sheet", () => {
  it("prices the default scope: rates and GST from the sheet, totals from recompute()", () => {
    const built = build();
    // 5000 sq ft x 100 + 5000 x 50 = 750,000; GST 5% of 500,000 + 18% of 250,000 = 70,000
    expect(built.totals).toEqual({ subtotal: 750_000, gstAmount: 70_000, grandTotal: 820_000 });
    expect(built.totals).toEqual(recompute(built.lines));
    const base = built.lines.find((l) => l.id === "base")!;
    expect(base).toMatchObject({ ratePerSqFt: 100, gstPercent: 5, areaSqFt: 5000, included: true });
    // optional items are on the quote but off
    expect(built.lines.filter((l) => !l.included).map((l) => l.id)).toEqual(["posts", "fence", "net"]);
  });

  it("every line carries the sheet's rate; nothing in the caller's patch can change it", () => {
    const built = build([{ rateItemId: "posts", quantity: 4 }, { rateItemId: "fence" }, { rateItemId: "net" }]);
    for (const l of built.lines) {
      const sheetItem = SHEET.find((s) => s.id === l.id)!;
      expect(l.ratePerSqFt).toBe(sheetItem.defaultRate);
      expect(l.gstPercent).toBe(sheetItem.gstPercent);
    }
    const posts = built.lines.find((l) => l.id === "posts")!;
    expect(posts).toMatchObject({ included: true, areaSqFt: 4, total: 8000 });
    // perimeter (100+50)*2 = 300 ft; wrap (300 x 10) + 5000 = 8000
    expect(built.lines.find((l) => l.id === "fence")!.areaSqFt).toBe(300);
    expect(built.lines.find((l) => l.id === "net")!.areaSqFt).toBe(8000);
    expect(built.totals).toEqual(recompute(built.lines));
  });

  it("a different plot size changes quantities, never rates", () => {
    const a = build(undefined, 10, 10);
    expect(a.lines.find((l) => l.id === "base")).toMatchObject({ areaSqFt: 100, ratePerSqFt: 100 });
    expect(a.totals.subtotal).toBe(100 * 100 + 100 * 50);
  });

  it("refuses a sheet with a negative rate or a bad GST instead of quoting it", () => {
    const poisoned = [{ ...SHEET[0], defaultRate: -5 }, ...SHEET.slice(1)];
    const { settings, named } = resolveItemSettings({ sheet: poisoned, patches: undefined });
    expect(() => buildQuoteLines({ sheet: poisoned, lengthFt: 10, widthFt: 10, settings, named })).toThrow(/invalid rate/);
    const badGst = [{ ...SHEET[0], gstPercent: 180 }, ...SHEET.slice(1)];
    expect(() => buildQuoteLines({ sheet: badGst, lengthFt: 10, widthFt: 10, settings, named })).toThrow(/invalid GST/);
  });
});

describe("validation edges", () => {
  const status = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as AgentHttpError).status;
    }
    return null;
  };

  it("rejects unknown rate items, repeats, and a quantity on a non-per-piece item", () => {
    expect(() => resolveItemSettings({ sheet: SHEET, patches: [{ rateItemId: "gold_plating" }] })).toThrow(/Unknown rate item/);
    expect(() => resolveItemSettings({ sheet: SHEET, patches: [{ rateItemId: "base" }, { rateItemId: "base" }] })).toThrow(/more than once/);
    expect(() => resolveItemSettings({ sheet: SHEET, patches: [{ rateItemId: "base", quantity: 3 }] })).toThrow(/per-piece/);
  });

  it("a per-piece item named without a quantity is refused (it would be a zero line)", () => {
    expect(() => build([{ rateItemId: "posts" }])).toThrow(/send a quantity/);
  });

  it("a per-piece item that is only in the default scope is left out with a warning, not quoted at zero", () => {
    const sheet = SHEET.map((s) => (s.id === "posts" ? { ...s, optional: false } : s));
    const { settings, named } = resolveItemSettings({ sheet, patches: undefined });
    const built = buildQuoteLines({ sheet, lengthFt: 10, widthFt: 10, settings, named });
    expect(built.lines.find((l) => l.id === "posts")!.included).toBe(false);
    expect(built.warnings.join(" ")).toMatch(/no quantity/);
  });

  it("a quote with nothing priced (a zero total) is a 422", () => {
    expect(
      status(() => build([{ rateItemId: "base", included: false }, { rateItemId: "turf", included: false }])),
    ).toBe(422);
  });

  it("assertPriceable rejects a negative rate, a negative quantity and a zero total", () => {
    const line = (over: Partial<QuoteLineItem>): QuoteLineItem => ({
      id: "x", name: "X", description: "", areaSqFt: 10, ratePerSqFt: 10, gstPercent: 18, total: 100, included: true, ...over,
    });
    expect(() => assertPriceable([line({ ratePerSqFt: -1 })])).toThrow(/negative or invalid rate/);
    expect(() => assertPriceable([line({ areaSqFt: -1 })])).toThrow(/negative or invalid quantity/);
    expect(() => assertPriceable([line({ gstPercent: 101 })])).toThrow(/invalid GST/);
    expect(() => assertPriceable([line({ ratePerSqFt: 0 })])).toThrow(/zero total/);
    expect(() => assertPriceable([line({ included: false })])).toThrow(/zero total/);
    expect(assertPriceable([line({})]).grandTotal).toBe(118);
  });

  it("rejects non-integer or sub-1 dimensions", () => {
    const { settings, named } = resolveItemSettings({ sheet: SHEET, patches: undefined });
    expect(() => buildQuoteLines({ sheet: SHEET, lengthFt: 0, widthFt: 10, settings, named })).toThrow();
    expect(() => buildQuoteLines({ sheet: SHEET, lengthFt: 10.5, widthFt: 10, settings, named })).toThrow();
  });
});

describe("the dedupe hash", () => {
  const hashOf = (over: Partial<Parameters<typeof quoteContentHash>[0]> = {}) => {
    const built = build();
    return quoteContentHash({ sport: "football", lengthFt: 100, widthFt: 50, lines: built.lines, notes: null, validityDays: 30, ...over });
  };

  it("is the same for the same content, whatever the line order or blank notes", () => {
    const built = build();
    const reversed = [...built.lines].reverse();
    expect(hashOf({ lines: reversed })).toBe(hashOf());
    expect(hashOf({ notes: undefined })).toBe(hashOf({ notes: null }));
    expect(hashOf({ notes: "  " })).toBe(hashOf({ notes: null }));
  });

  it("changes with any change a customer would pay for or read", () => {
    const base = hashOf();
    expect(hashOf({ lengthFt: 101 })).not.toBe(base);
    expect(hashOf({ sport: "tennis" })).not.toBe(base);
    expect(hashOf({ validityDays: 31 })).not.toBe(base);
    expect(hashOf({ notes: "Site visit first" })).not.toBe(base);
    expect(quoteContentHash({ sport: "football", lengthFt: 100, widthFt: 50, notes: null, validityDays: 30, lines: build([{ rateItemId: "fence" }]).lines })).not.toBe(base);
    const repriced = build().lines.map((l) => (l.id === "base" ? { ...l, ratePerSqFt: 99 } : l));
    expect(hashOf({ lines: repriced })).not.toBe(base);
  });

  it("ignores lines that are switched off", () => {
    const lines = build().lines;
    const withOffLineEdited = lines.map((l) => (l.id === "posts" ? { ...l, areaSqFt: 7 } : l));
    expect(hashOf({ lines: withOffLineEdited })).toBe(hashOf());
  });
});

describe("carrying a quote's scope over to a new version", () => {
  it("keeps what was in and the piece counts, and re-prices from the sheet it is given", () => {
    const first = build([{ rateItemId: "posts", quantity: 6 }]);
    const base = settingsFromLines(first.lines, SHEET);
    const cheaperSheet = SHEET.map((s) => (s.id === "base" ? { ...s, defaultRate: 90 } : s));
    const { settings, named } = resolveItemSettings({ sheet: cheaperSheet, patches: undefined, base });
    const next = buildQuoteLines({ sheet: cheaperSheet, lengthFt: 100, widthFt: 50, settings, named });
    expect(next.lines.find((l) => l.id === "base")!.ratePerSqFt).toBe(90);
    expect(next.lines.find((l) => l.id === "posts")).toMatchObject({ included: true, areaSqFt: 6 });
    expect(next.lines.find((l) => l.id === "fence")!.included).toBe(false);
  });

  it("totalsMatchLines spots a row whose numbers no longer match its lines", () => {
    const b = build();
    expect(totalsMatchLines({ lines: b.lines, subtotal: b.totals.subtotal, gstAmount: b.totals.gstAmount, grandTotal: b.totals.grandTotal })).toBe(true);
    expect(totalsMatchLines({ lines: b.lines, subtotal: b.totals.subtotal, gstAmount: b.totals.gstAmount, grandTotal: b.totals.grandTotal - 1 })).toBe(false);
  });
});

describe("stages", () => {
  it("separates draft, pending, approved and what follows", () => {
    expect(quoteStage({ status: "draft", approvalState: "none" })).toBe("draft");
    expect(quoteStage({ status: "draft", approvalState: "rejected" })).toBe("draft");
    expect(quoteStage({ status: "draft", approvalState: "pending" })).toBe("pending_approval");
    expect(quoteStage({ status: "draft", approvalState: "approved" })).toBe("approved");
    expect(quoteStage({ status: "sent", approvalState: "approved" })).toBe("sent");
    expect(quoteStage({ status: "accepted", approvalState: "approved" })).toBe("accepted");
    expect(quoteStage({ status: "superseded", approvalState: "approved" })).toBe("closed");
  });

  it("only an approved quote is free of the draft notice", () => {
    expect(noticeFor({ status: "draft", approvalState: "none" })).toMatch(/DRAFT/);
    expect(noticeFor({ status: "draft", approvalState: "pending" })).toMatch(/WAITING/);
    expect(noticeFor({ status: "draft", approvalState: "approved" })).toBeNull();
  });
});

describe("applyDiscount", () => {
  const lines = (): QuoteLineItem[] => build().lines;

  it("changes only the named lines, and exactly to the approved rate", () => {
    const before = lines();
    const out = applyDiscount(before, { lines: [{ rateItemId: "base", requestedRate: 90 }] });
    expect(out.changes).toEqual([{ rateItemId: "base", name: "Base", from: 100, to: 90 }]);
    expect(out.lines.find((l) => l.id === "base")).toMatchObject({ ratePerSqFt: 90, total: 5000 * 90 });
    expect(out.lines.find((l) => l.id === "turf")!.ratePerSqFt).toBe(50);
    // the input is not mutated
    expect(before.find((l) => l.id === "base")!.ratePerSqFt).toBe(100);
    expect(out.totals).toEqual(recompute(out.lines));
    expect(out.totals.grandTotal).toBeLessThan(recompute(before).grandTotal);
  });

  it("a percentage applies to the included lines only", () => {
    const out = applyDiscount(lines(), { percent: 10 });
    expect(out.changes.map((c) => c.rateItemId).sort()).toEqual(["base", "turf"]);
    expect(out.lines.find((l) => l.id === "base")!.ratePerSqFt).toBe(90);
    expect(out.lines.find((l) => l.id === "turf")!.ratePerSqFt).toBe(45);
    expect(out.lines.find((l) => l.id === "posts")!.ratePerSqFt).toBe(2000);
  });

  it("can never raise a price, and never to zero or a negative rate", () => {
    expect(() => applyDiscount(lines(), { lines: [{ rateItemId: "base", requestedRate: 100 }] })).toThrow(DiscountError);
    expect(() => applyDiscount(lines(), { lines: [{ rateItemId: "base", requestedRate: 120 }] })).toThrow(/not below/);
    expect(() => applyDiscount(lines(), { lines: [{ rateItemId: "base", requestedRate: 0 }] })).toThrow(/above zero/);
    expect(() => applyDiscount(lines(), { lines: [{ rateItemId: "base", requestedRate: -3 }] })).toThrow(DiscountError);
  });

  it(`refuses more than ${MAX_DISCOUNT_PERCENT}% off`, () => {
    expect(() => applyDiscount(lines(), { lines: [{ rateItemId: "base", requestedRate: 49 }] })).toThrow(/above 50%/);
    expect(() => applyDiscount(lines(), { percent: 51 })).toThrow(DiscountError);
    expect(applyDiscount(lines(), { lines: [{ rateItemId: "base", requestedRate: 50 }] }).changes).toHaveLength(1);
  });

  it("refuses a line that is not on the quote or is switched off", () => {
    expect(() => applyDiscount(lines(), { lines: [{ rateItemId: "nope", requestedRate: 1 }] })).toThrow(/no line/);
    expect(() => applyDiscount(lines(), { lines: [{ rateItemId: "posts", requestedRate: 1000 }] })).toThrow(/not included/);
  });
});
