/**
 * The arithmetic underneath every component.
 *
 * These are small functions and it would be easy to skip testing them, but
 * they are the ones that produce the numbers a salesperson reads aloud — a
 * decay term that returned 1 at every distance would be invisible in the total
 * and wrong in every report.
 */

import { describe, expect, it } from "vitest";

import {
  clamp,
  distanceDecay,
  formatCount,
  formatDistance,
  formatNumber,
  formatWeight,
  median,
  normalisedConcentration,
  plural,
  round,
  saturating,
} from "./curves";

describe("saturating curve", () => {
  it("awards about 63 % of the points at x₀", () => {
    expect(saturating(10, 10, 30)).toBeCloseTo(30 * (1 - Math.exp(-1)), 6);
    expect(saturating(10, 10, 30) / 30).toBeCloseTo(0.6321, 4);
  });

  it("is zero at zero and never reaches the maximum", () => {
    expect(saturating(0, 10, 30)).toBe(0);
    // 30×x₀ — far beyond anything a catchment produces, and still short of the
    // maximum. (Push it far enough and the exponential underflows to exactly
    // zero in double precision; the asymptote is a modelling property, not a
    // claim about IEEE 754.)
    expect(saturating(300, 10, 30)).toBeLessThan(30);
    expect(saturating(300, 10, 30)).toBeCloseTo(30, 6);
  });

  it("is monotonic — more input never scores less", () => {
    let previous = -1;
    for (let x = 0; x <= 100; x += 1) {
      const value = saturating(x, 16, 30);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("returns zero rather than NaN for nonsense input", () => {
    expect(saturating(Number.NaN, 10, 30)).toBe(0);
    expect(saturating(-5, 10, 30)).toBe(0);
    expect(saturating(10, 0, 30)).toBe(0);
  });
});

describe("distance decay", () => {
  it("is 1 at the centre and e⁻¹ at the decay distance", () => {
    expect(distanceDecay(0, 1000)).toBe(1);
    expect(distanceDecay(1000, 1000)).toBeCloseTo(Math.exp(-1), 6);
    expect(distanceDecay(2000, 1000)).toBeCloseTo(Math.exp(-2), 6);
  });

  it("falls away with distance", () => {
    expect(distanceDecay(500, 1000)).toBeGreaterThan(distanceDecay(1500, 1000));
  });
});

describe("normalised concentration", () => {
  it("is 1 for a single holder — one operator owning the market", () => {
    expect(normalisedConcentration([400])).toBe(1);
  });

  it("is 0 for a perfectly even split", () => {
    expect(normalisedConcentration([100, 100, 100, 100])).toBeCloseTo(0, 10);
  });

  it("rises as one holder takes more", () => {
    const even = normalisedConcentration([100, 100, 100]);
    const skewed = normalisedConcentration([280, 10, 10]);
    expect(skewed).toBeGreaterThan(even);
    expect(skewed).toBeLessThanOrEqual(1);
  });

  it("is 0 for an empty list", () => {
    expect(normalisedConcentration([])).toBe(0);
  });
});

describe("median", () => {
  it("returns null for an empty list rather than zero", () => {
    expect(median([])).toBeNull();
  });

  it("averages the middle pair on an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not depend on input order", () => {
    expect(median([9, 1, 5])).toBe(5);
  });
});

describe("formatting is locale-independent", () => {
  it("groups thousands the same way on every runtime", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(0)).toBe("0");
  });

  it("drops a trailing .0 in prose but keeps two places on a weight", () => {
    expect(formatNumber(4.0, 1)).toBe("4");
    expect(formatNumber(4.05, 1)).toBe("4.1");
    expect(formatWeight(1)).toBe("1.00");
    expect(formatWeight(0.8)).toBe("0.80");
  });

  it("switches to kilometres above a kilometre", () => {
    expect(formatDistance(640)).toBe("640 m");
    expect(formatDistance(1800)).toBe("1.8 km");
    expect(formatDistance(2000)).toBe("2 km");
  });

  it("pluralises on the count", () => {
    expect(plural(1, "facility", "facilities")).toBe("1 facility");
    expect(plural(6, "facility", "facilities")).toBe("6 facilities");
    expect(plural(0, "facility", "facilities")).toBe("0 facilities");
  });
});

describe("rounding and clamping", () => {
  it("rounds to the requested places", () => {
    expect(round(1.005, 2)).toBe(1.0);
    expect(round(1.006, 2)).toBe(1.01);
    expect(round(66.845, 1)).toBe(66.8);
  });

  it("returns zero rather than NaN", () => {
    expect(round(Number.NaN)).toBe(0);
  });

  it("clamps to the given bounds", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });
});
