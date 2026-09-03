/**
 * What the model must do, stated as tests.
 *
 * The cases that matter here are the ones where a naive model gets it wrong:
 * empty ground scoring well because nothing competes with it, an unsurveyed
 * site outranking a surveyed one, a component quietly scoring missing data as
 * zero. Each of those has a named test below, and each corresponds to a line
 * in the acceptance criteria of `plan/agents/phase-3-scoring-engine.md`.
 */

import { describe, expect, it } from "vitest";

import {
  computeScore,
  parseScoreModel,
  SCORE_MODEL_V1,
  SURVEYOR_CHECKLIST,
  UnsupportedScoreModelError,
  type ScoreInput,
  type ScoreModel,
} from "@/lib/scout/scoring";
import {
  FULL_SURVEY,
  denseUnderserved,
  denseWellServed,
  deskOnly,
  emptyFarmland,
  emptyFarmlandFullySurveyed,
  noEveningPlay,
  zeroCompetitorsWithDemand,
} from "../../../../tests/fixtures/scoring";

const model = SCORE_MODEL_V1;

/** Deep clone that keeps the model a plain data structure. */
function cloneModel(): ScoreModel {
  return JSON.parse(JSON.stringify(model)) as ScoreModel;
}

describe("the model is well formed", () => {
  it("v1.0.0 validates, and is stamped 1.0.0", () => {
    const parsed = parseScoreModel(JSON.parse(JSON.stringify(SCORE_MODEL_V1)));
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.includesPopulation).toBe(false);
  });

  it("weights every checklist field, so no field is silently unscored", () => {
    for (const field of SURVEYOR_CHECKLIST) {
      expect(
        model.weights.practicals.fieldWeights[field.id],
        `checklist field ${field.id} has no weight in model ${model.version}`,
      ).toBeTypeOf("number");
    }
    expect(Object.keys(model.weights.practicals.fieldWeights)).toHaveLength(
      SURVEYOR_CHECKLIST.length,
    );
  });

  it("refuses to score a model that declares a population base", () => {
    const future = { ...cloneModel(), includesPopulation: true };
    expect(() => computeScore(denseUnderserved, future)).toThrow(UnsupportedScoreModelError);
  });
});

describe("every component explains itself", () => {
  const result = computeScore(denseUnderserved, model);

  it("returns all five components with points, availability and inputs", () => {
    expect(result.components.map((c) => c.id)).toEqual([
      "demand-anchors",
      "competitive-saturation",
      "market-proof",
      "service-gap",
      "site-practicals",
    ]);
    for (const component of result.components) {
      expect(component.available).toBeGreaterThan(0);
      expect(component.points).toBeGreaterThanOrEqual(0);
      expect(component.points).toBeLessThanOrEqual(component.available);
      expect(Object.keys(component.inputs).length).toBeGreaterThan(0);
    }
  });

  it("gives every component a justification citing its own numbers", () => {
    for (const component of result.components) {
      expect(component.justification.length).toBeGreaterThan(40);
      // A justification with no digit in it is not citing anything.
      expect(component.justification).toMatch(/\d/);
      expect(component.justification.trim().endsWith(".")).toBe(true);
    }
  });

  it("says Google-listed rather than implying a census of the area", () => {
    const saturation = result.components.find((c) => c.id === "competitive-saturation")!;
    expect(saturation.justification).toMatch(/Google-listed/);
  });

  it("component points sum to the total when nothing is excluded", () => {
    const sum = result.components.reduce((s, c) => s + c.points, 0);
    expect(result.pointsAwarded).toBeCloseTo(sum, 2);
    expect(result.pointsAvailable).toBe(100);
    expect(result.total).toBeCloseTo(sum, 2);
  });
});

describe("the two rules that stop the model being naive", () => {
  /**
   * The single most important test in the project. Components 2 and 3 pull
   * against each other: farmland scores high on saturation because nothing
   * competes with it, and zero on market proof because nobody is paying to
   * play. If that combination clears the Avoid threshold, the tool would
   * recommend a field in the middle of nowhere.
   */
  it("a zero-anchor, zero-competitor, zero-review location scores below Avoid", () => {
    const result = computeScore(emptyFarmland, model);
    expect(result.total).toBeLessThan(model.weights.verdictBands.investigate);
    expect(result.verdict).toBe("avoid");

    const saturation = result.components.find((c) => c.id === "competitive-saturation")!;
    const proof = result.components.find((c) => c.id === "market-proof")!;
    // Saturation scores well precisely because nothing competes …
    expect(saturation.points).toBeGreaterThan(0);
    // … and market proof is what refuses to let that stand alone.
    expect(proof.points).toBe(0);
  });

  it("stays below Avoid even with a perfect site survey", () => {
    const result = computeScore(emptyFarmlandFullySurveyed, model);
    expect(result.basis).toBe("full");
    expect(result.total).toBeLessThan(model.weights.verdictBands.investigate);
    expect(result.verdict).toBe("avoid");
  });

  it("caps competitive saturation at 16/20 with a flag when there are no competitors", () => {
    const result = computeScore(zeroCompetitorsWithDemand, model);
    const saturation = result.components.find((c) => c.id === "competitive-saturation")!;

    expect(saturation.points).toBe(model.weights.saturation.zeroCompetitorCap);
    expect(saturation.points).toBeLessThan(saturation.available);
    expect(saturation.flags.map((f) => f.code)).toContain("saturation_zero_competitors");
    expect(result.flags.map((f) => f.code)).toContain("saturation_zero_competitors");
  });

  it("never awards competitive saturation more than the cap", () => {
    for (const input of [emptyFarmland, zeroCompetitorsWithDemand]) {
      const saturation = computeScore(input, model).components.find(
        (c) => c.id === "competitive-saturation",
      )!;
      expect(saturation.points).toBeLessThanOrEqual(model.weights.saturation.zeroCompetitorCap);
    }
  });
});

describe("the model discriminates between real areas", () => {
  it("a dense under-served area clearly outscores a dense well-served one", () => {
    const under = computeScore(denseUnderserved, model);
    const served = computeScore(denseWellServed, model);

    expect(under.total).toBeGreaterThan(served.total);
    // "Clearly" — a difference inside rounding noise would not be an argument
    // anyone could make across a table.
    expect(under.total - served.total).toBeGreaterThan(5);

    const underSat = under.components.find((c) => c.id === "competitive-saturation")!;
    const servedSat = served.components.find((c) => c.id === "competitive-saturation")!;
    expect(underSat.points).toBeGreaterThan(servedSat.points);
  });

  it("the demand-anchor component reflects the anchors actually found", () => {
    const dense = computeScore(denseUnderserved, model).components[0]!;
    const empty = computeScore(emptyFarmland, model).components[0]!;
    expect(dense.inputs.anchorCount).toBe(61);
    expect(dense.points).toBeGreaterThan(15);
    expect(empty.inputs.anchorCount).toBe(0);
    expect(empty.points).toBe(0);
  });
});

describe("missing surveyor input degrades gracefully", () => {
  const surveyed = computeScore(denseUnderserved, model);
  const desk = computeScore(deskOnly, model);

  it("excludes component 5 rather than scoring it zero", () => {
    const practicals = desk.components.find((c) => c.id === "site-practicals")!;
    expect(practicals.included).toBe(false);
    expect(practicals.points).toBe(0);
    expect(desk.pointsAvailable).toBe(85);
  });

  it("rescales the remaining components to 100 and flags the basis", () => {
    expect(desk.basis).toBe("desk_only");
    expect(desk.basisLabel).not.toBe("");
    expect(surveyed.basis).toBe("full");
    expect(surveyed.basisLabel).toBe("");

    const awarded = desk.pointsAwarded;
    expect(desk.total).toBeCloseTo((awarded / 85) * 100, 2);
  });

  it("says so in the verdict statement, because the two are not comparable", () => {
    expect(desk.verdictStatement).toMatch(/desk assessment/i);
    expect(desk.verdictStatement).toMatch(/cannot be ranked/i);
    expect(surveyed.verdictStatement).not.toMatch(/desk assessment/i);
  });

  it("lowers confidence when nobody visited the site", () => {
    expect(desk.confidence.penalty).toBeGreaterThan(surveyed.confidence.penalty);
    expect(desk.confidence.reasons.join(" ")).toMatch(/no site survey/i);
  });

  it("treats a token two-field survey as no survey at all", () => {
    const barely: ScoreInput = {
      ...denseUnderserved,
      surveyor: { parking: 2, visibility: 3 },
    };
    const result = computeScore(barely, model);
    expect(result.basis).toBe("desk_only");
    expect(result.flags.map((f) => f.code)).toContain("practicals_not_surveyed");
  });

  it("scores a partial survey over the answered fields and says which are missing", () => {
    const partial: ScoreInput = {
      ...denseUnderserved,
      surveyor: {
        "road-frontage": 3,
        parking: 3,
        visibility: 3,
        "approach-road": 3,
        "distance-to-transit": 3,
      },
    };
    const result = computeScore(partial, model);
    const practicals = result.components.find((c) => c.id === "site-practicals")!;
    expect(result.basis).toBe("full");
    // Five perfect answers renormalise to the full 15 — unanswered fields are
    // left out of the average rather than counted as zero.
    expect(practicals.points).toBe(15);
    expect(result.flags.map((f) => f.code)).toContain("practicals_partial_survey");
  });
});

describe("hard flags surface regardless of the total", () => {
  it("evening play prohibited raises a hard flag on a high-scoring site", () => {
    const result = computeScore(noEveningPlay, model);
    expect(result.hardFlags).toHaveLength(1);
    expect(result.hardFlags[0]!.code).toBe(
      "practicals_hard_flag:evening-play-restrictions",
    );
    expect(result.hardFlags[0]!.message).toMatch(/Night play prohibited/);
    // The point of a hard flag is that the total does not suppress it.
    expect(result.total).toBeGreaterThan(model.weights.verdictBands.investigate);
  });

  it("raises no hard flag when evening play is unrestricted", () => {
    expect(computeScore(denseUnderserved, model).hardFlags).toHaveLength(0);
  });

  it("raises the flag even when the rest of the survey is too thin to score", () => {
    const result = computeScore(
      { ...denseUnderserved, surveyor: { "evening-play-restrictions": 0 } },
      model,
    );
    expect(result.basis).toBe("desk_only");
    expect(result.hardFlags.map((f) => f.code)).toContain(
      "practicals_hard_flag:evening-play-restrictions",
    );
  });

  it("honours a hard flag added to the model without a code change", () => {
    const tuned = cloneModel();
    tuned.weights.practicals.hardFlagAtOrBelow = { drainage: 1 };
    const result = computeScore(denseUnderserved, tuned);
    expect(result.hardFlags.map((f) => f.code)).toEqual(["practicals_hard_flag:drainage"]);
  });
});

describe("determinism and reproducibility", () => {
  it("the same input and model version produce an identical result", () => {
    const a = computeScore(denseUnderserved, model);
    const b = computeScore(denseUnderserved, model);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("stamps the model and checklist versions on the result", () => {
    const result = computeScore(denseUnderserved, model);
    expect(result.modelVersion).toBe("1.0.0");
    expect(result.checklistVersion).toBe("1.0.0");
  });

  it("does not depend on the order places arrive in", () => {
    const reversed: ScoreInput = {
      ...denseUnderserved,
      places: [...denseUnderserved.places].reverse(),
    };
    expect(computeScore(reversed, model).total).toBe(computeScore(denseUnderserved, model).total);
  });
});

describe("weights are tunable, and their effect is proportional", () => {
  /**
   * The sensitivity report the acceptance criteria asks for: move one
   * component's weight by ±20 % and its contribution moves with it, while the
   * others are untouched. Printed on failure so a surprising model change is
   * legible rather than a bare boolean.
   */
  it("a ±20 % change to a component weight moves that component proportionally", () => {
    const base = computeScore(denseUnderserved, model);
    const rows: string[] = [];

    for (const key of [
      "demandAnchors",
      "competitiveSaturation",
      "marketProof",
      "serviceGap",
      "sitePracticals",
    ] as const) {
      for (const factor of [0.8, 1.2]) {
        const tuned = cloneModel();
        const original = tuned.weights.components[key];
        tuned.weights.components[key] = original * factor;
        // Keep the sub-part budgets consistent with the component they add up to.
        if (key === "serviceGap") {
          for (const part of [
            "ratingGapPoints",
            "concentrationPoints",
            "unservedSportsPoints",
            "complaintThemePoints",
          ] as const) {
            tuned.weights.serviceGap[part] *= factor;
          }
        }
        if (key === "marketProof") {
          tuned.weights.marketProof.totalReviewsPoints *= factor;
          tuned.weights.marketProof.perFacilityPoints *= factor;
        }
        if (key === "competitiveSaturation") {
          tuned.weights.saturation.zeroCompetitorCap *= factor;
        }

        const tunedResult = computeScore(denseUnderserved, tuned);
        const before = base.components.find((c) => c.id === componentIdFor(key))!.points;
        const after = tunedResult.components.find((c) => c.id === componentIdFor(key))!.points;
        rows.push(
          `${key} ×${factor}: ${before.toFixed(2)} → ${after.toFixed(2)} (total ${base.total} → ${tunedResult.total})`,
        );
        // 2 dp: component points are published rounded to 2 dp, so the ratio
        // of two published numbers cannot be exact — only proportional.
        expect(after / before, rows.join("\n")).toBeCloseTo(factor, 2);
      }
    }

    expect(rows).toHaveLength(10);
  });

  it("a change to a curve constant changes the score", () => {
    const tuned = cloneModel();
    tuned.weights.anchors.curveX0 = 9;
    expect(computeScore(denseUnderserved, tuned).total).not.toBe(
      computeScore(denseUnderserved, model).total,
    );
  });

  it("verdict thresholds come from the model, not from code", () => {
    const tuned = cloneModel();
    tuned.weights.verdictBands = { proceed: 5, investigate: 1 };
    expect(computeScore(emptyFarmland, tuned).verdict).toBe("proceed");
  });
});

function componentIdFor(key: string): string {
  return {
    demandAnchors: "demand-anchors",
    competitiveSaturation: "competitive-saturation",
    marketProof: "market-proof",
    serviceGap: "service-gap",
    sitePracticals: "site-practicals",
  }[key]!;
}

describe("confidence is a separate axis from the score", () => {
  it("is high when the evidence is complete", () => {
    expect(computeScore(denseUnderserved, model).confidence.level).toBe("high");
  });

  it("drops when counts were truncated, and says which term", () => {
    const truncated: ScoreInput = {
      ...denseUnderserved,
      anySaturated: true,
      saturatedTermLabels: ["Schools"],
    };
    const result = computeScore(truncated, model);
    expect(result.confidence.level).not.toBe("high");
    expect(result.confidence.reasons.join(" ")).toMatch(/Schools/);
    expect(result.countsAreExact).toBe(false);
    expect(result.flags.map((f) => f.code)).toContain("counts_are_floors");
  });

  it("qualifies every count as a floor when any term saturated", () => {
    const truncated: ScoreInput = {
      ...denseUnderserved,
      anySaturated: true,
      saturatedTermLabels: ["Schools"],
    };
    const result = computeScore(truncated, model);
    const anchors = result.components.find((c) => c.id === "demand-anchors")!;
    expect(anchors.justification).toMatch(/at least/);
  });

  it("drops when the city benchmark is thin, and names the sample count", () => {
    const thin: ScoreInput = {
      ...denseUnderserved,
      benchmark: { city: "Coimbatore", anchorsPerFacility: 3.2, medianRating: 4.2, sampleCount: 3 },
    };
    const result = computeScore(thin, model);
    expect(result.confidence.reasons.join(" ")).toMatch(/3 scans/);
    expect(result.flags.map((f) => f.code)).toContain("saturation_benchmark_indicative");
  });

  it("falls to low when several kinds of evidence are missing at once", () => {
    const thin: ScoreInput = {
      ...deskOnly,
      anySaturated: true,
      saturatedTermLabels: ["Schools"],
      benchmark: null,
    };
    expect(computeScore(thin, model).confidence.level).toBe("low");
  });
});

describe("null is not zero", () => {
  it("ignores unrated competitors rather than averaging them as zero", () => {
    const withUnrated: ScoreInput = {
      ...denseUnderserved,
      places: [
        ...denseUnderserved.places,
        {
          placeId: "unrated-turf",
          name: "Unrated Turf",
          side: "competition",
          categories: ["turf-sports"],
          matchedTerms: ["football-turf-5s"],
          distanceM: 900,
          rating: null,
          reviewCount: null,
          businessStatus: "OPERATIONAL",
        },
      ],
    };
    const base = computeScore(denseUnderserved, model).components.find((c) => c.id === "service-gap")!;
    const withNull = computeScore(withUnrated, model).components.find((c) => c.id === "service-gap")!;
    expect(withNull.inputs.avgRating).toBe(base.inputs.avgRating);
  });

  it("excludes permanently closed venues from the competitor count", () => {
    const withClosed: ScoreInput = {
      ...denseUnderserved,
      places: [
        ...denseUnderserved.places,
        {
          placeId: "closed-turf",
          name: "Closed Turf",
          side: "competition",
          categories: ["turf-sports"],
          matchedTerms: ["football-turf-5s"],
          distanceM: 700,
          rating: 4.0,
          reviewCount: 50,
          businessStatus: "CLOSED_PERMANENTLY",
        },
      ],
    };
    const result = computeScore(withClosed, model);
    const saturation = result.components.find((c) => c.id === "competitive-saturation")!;
    expect(saturation.inputs.facilityCount).toBe(4);
    expect(result.flags.map((f) => f.code)).toContain("closed_competitors_excluded");
  });
});

describe("service gap refuses to score absent evidence as a finding", () => {
  it("awards nothing for the rating gap when nothing is rated", () => {
    const unrated: ScoreInput = {
      ...denseUnderserved,
      places: denseUnderserved.places.map((p) =>
        p.side === "competition" ? { ...p, rating: null } : p,
      ),
    };
    const gap = computeScore(unrated, model).components.find((c) => c.id === "service-gap")!;
    expect(gap.parts.find((p) => p.id === "rating-gap")!.points).toBe(0);
    expect(gap.flags.map((f) => f.code)).toContain("service_gap_rating_unmeasured");
  });

  it("does not pay for unserved formats where there is no demand to serve", () => {
    const gap = computeScore(emptyFarmland, model).components.find((c) => c.id === "service-gap")!;
    expect(gap.inputs.unservedFormatCount).toBe(5);
    expect(gap.parts.find((p) => p.id === "unserved-sports")!.points).toBe(0);
  });

  it("distinguishes 'not analysed yet' from 'analysed, nothing found'", () => {
    const notYet = computeScore(
      { ...denseUnderserved, reviewThemes: [], themesExtracted: false },
      model,
    );
    const analysed = computeScore(
      { ...denseUnderserved, reviewThemes: [], themesExtracted: true },
      model,
    );
    expect(notYet.flags.map((f) => f.code)).toContain("service_gap_themes_not_extracted");
    expect(analysed.flags.map((f) => f.code)).not.toContain("service_gap_themes_not_extracted");
  });

  it("scores a complaint recurring across venues, and names it", () => {
    const gap = computeScore(denseUnderserved, model).components.find((c) => c.id === "service-gap")!;
    expect(gap.inputs.topComplaintTheme).toBe("parking");
    expect(gap.inputs.topComplaintVenues).toBe(3);
    expect(gap.justification).toMatch(/parking/);
  });
});

describe("surveyor input is sanitised before it can reach the score", () => {
  it("accepts a complete valid survey", () => {
    const result = computeScore({ ...denseUnderserved, surveyor: FULL_SURVEY }, model);
    const practicals = result.components.find((c) => c.id === "site-practicals")!;
    expect(practicals.inputs.answeredFieldCount).toBe(14);
  });
});
