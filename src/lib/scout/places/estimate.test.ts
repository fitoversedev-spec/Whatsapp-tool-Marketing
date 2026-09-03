/**
 * The estimator is what the surveyor sees before spending money, so it is
 * tested for honesty as much as correctness: it must never quote a floor as if
 * it were the price, and it must never throw while someone is dragging the
 * radius slider.
 */
import { describe, expect, it } from "vitest";

import { countTiles } from "@/lib/scout/geo/tiling";

import { estimateScan, formatDuration } from "./estimate";
import { categoriesForPreset, resolveTerms } from "./taxonomy";

const QUICK = categoriesForPreset("quick-check").map((c) => c.id);
const FULL = categoriesForPreset("full-sweep").map((c) => c.id);

describe("estimateScan", () => {
  it("issues one call per tile per term at minimum", () => {
    const estimate = estimateScan({ categoryIds: ["water"], radiusM: 2_000 });
    // `water` is a single nearby term, so the arithmetic is visible.
    expect(estimate.terms).toBe(1);
    expect(estimate.tiles).toBe(countTiles(2_000, 800));
    expect(estimate.minCalls).toBe(estimate.tiles);
    expect(estimate.maxCalls).toBe(estimate.tiles);
  });

  it("prices text terms above their floor, because pagination is billed per page", () => {
    // A nearby term is one call. A text term is one call per query string, and
    // up to three pages each when the area is dense. Quoting only the floor is
    // how a Full sweep in Indiranagar surprises someone.
    const estimate = estimateScan({ categoryIds: ["cricket"], radiusM: 2_000 });
    expect(estimate.textTerms).toBe(2);
    expect(estimate.nearbyTerms).toBe(0);
    expect(estimate.maxCalls).toBeGreaterThan(estimate.minCalls);
    expect(estimate.maxCalls).toBe(estimate.minCalls * 3);
  });

  it("makes a Full sweep roughly five times a Quick check, as the client was told", () => {
    const quick = estimateScan({ categoryIds: QUICK, radiusM: 2_000 });
    const full = estimateScan({ categoryIds: FULL, radiusM: 2_000 });
    const ratio = full.minCalls / quick.minCalls;
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(9);
  });

  it("grows faster than linearly with the radius, because tiles cover area", () => {
    // Doubling the radius does not double the cost, it roughly triples it —
    // the ratio falls short of a clean 4× only because the outermost ring of
    // tiles overhangs the catchment, and that overhang is proportionally
    // larger at 2 km than at 4 km.
    const two = estimateScan({ categoryIds: QUICK, radiusM: 2_000 });
    const four = estimateScan({ categoryIds: QUICK, radiusM: 4_000 });
    const ratio = four.minCalls / two.minCalls;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThanOrEqual(4);
  });

  it("charges competition at the Atmosphere tier and education at Pro", () => {
    const competition = estimateScan({ categoryIds: ["water"], radiusM: 1_000 });
    const demand = estimateScan({ categoryIds: ["transit"], radiusM: 1_000 });
    expect(competition.callsByTier.ENTERPRISE_ATMOSPHERE).toBeGreaterThan(0);
    expect(demand.callsByTier.PRO).toBeGreaterThan(0);
    // Per call, reviews cost more than a bus stop does.
    expect(competition.minCostUsd / competition.minCalls).toBeGreaterThan(
      demand.minCostUsd / demand.minCalls,
    );
  });

  it("quotes a cost band, never a single number", () => {
    const estimate = estimateScan({ categoryIds: FULL, radiusM: 2_000 });
    expect(estimate.minCostUsd).toBeGreaterThan(0);
    expect(estimate.maxCostUsd).toBeGreaterThan(estimate.minCostUsd);
  });

  it("assumes a cold cache by default, which is the worst case", () => {
    const cold = estimateScan({ categoryIds: QUICK, radiusM: 2_000 });
    const warm = estimateScan({ categoryIds: QUICK, radiusM: 2_000, cacheHitRate: 0.8 });
    expect(warm.minCostUsd).toBeLessThan(cold.minCostUsd);
    expect(warm.estimatedDurationMs).toBeLessThan(cold.estimatedDurationMs);
    // Call *counts* still describe the work planned; only the price falls.
    expect(warm.minCalls).toBe(cold.minCalls);
  });

  it("clamps an out-of-range cache hit rate rather than producing a negative price", () => {
    expect(estimateScan({ categoryIds: QUICK, radiusM: 2_000, cacheHitRate: 5 }).minCostUsd).toBe(0);
    expect(
      estimateScan({ categoryIds: QUICK, radiusM: 2_000, cacheHitRate: -5 }).minCostUsd,
    ).toBeGreaterThan(0);
  });

  it("estimates a duration that falls as concurrency rises", () => {
    const serial = estimateScan({ categoryIds: QUICK, radiusM: 2_000, concurrency: 1 });
    const parallel = estimateScan({ categoryIds: QUICK, radiusM: 2_000, concurrency: 8 });
    expect(parallel.estimatedDurationMs).toBeLessThan(serial.estimatedDurationMs);
  });

  it("never throws on nonsense input — the slider is still moving", () => {
    for (const radiusM of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const estimate = estimateScan({ categoryIds: QUICK, radiusM });
      expect(estimate.tiles).toBe(0);
      expect(estimate.minCalls).toBe(0);
    }
    expect(estimateScan({ categoryIds: [], radiusM: 2_000 }).minCalls).toBe(0);
    expect(estimateScan({ categoryIds: ["not-a-category"], radiusM: 2_000 }).terms).toBe(0);
  });

  it("flags a plan the tiler would refuse instead of quoting it", () => {
    const estimate = estimateScan({ categoryIds: QUICK, radiusM: 20_000, tileRadiusM: 300 });
    expect(estimate.exceedsTileLimit).toBe(true);
  });

  it("counts terms exactly as the pipeline will execute them", () => {
    const estimate = estimateScan({ categoryIds: FULL, radiusM: 1_000 });
    expect(estimate.terms).toBe(resolveTerms(FULL).length);
    expect(estimate.nearbyTerms + estimate.textTerms).toBe(estimate.terms);
  });
});

describe("formatDuration", () => {
  it.each([
    [500, "under a second"],
    [4_000, "about 4 s"],
    [89_000, "about 89 s"],
    [120_000, "about 2 min"],
    [400_000, "about 7 min"],
  ])("renders %d ms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
