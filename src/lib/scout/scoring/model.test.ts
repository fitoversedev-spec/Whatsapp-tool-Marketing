/**
 * Model validation.
 *
 * The model arrives from a database row, which means it arrives from whatever
 * an admin last typed. A model whose components do not total 100 would score
 * every report quietly wrong until somebody checked the arithmetic, so the
 * parser refuses it rather than repairing it.
 */

import { describe, expect, it } from "vitest";

import { InvalidScoreModelError, parseScoreModel, SCORE_MODEL_V1 } from "@/lib/scout/scoring";
import type { ScoreModel } from "@/lib/scout/scoring";

function plainV1(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SCORE_MODEL_V1)) as Record<string, unknown>;
}

function mutate(fn: (m: ScoreModel) => void): Record<string, unknown> {
  const model = JSON.parse(JSON.stringify(SCORE_MODEL_V1)) as ScoreModel;
  fn(model);
  return model as unknown as Record<string, unknown>;
}

describe("parseScoreModel", () => {
  it("accepts v1.0.0 unchanged", () => {
    const parsed = parseScoreModel(plainV1());
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.weights.components.demandAnchors).toBe(30);
  });

  it("requires a three-part semver, so 1.0 is not a version", () => {
    expect(() => parseScoreModel(mutate((m) => ((m as { version: string }).version = "1.0")))).toThrow(
      InvalidScoreModelError,
    );
  });

  it("refuses components that do not total 100", () => {
    expect(() =>
      parseScoreModel(mutate((m) => (m.weights.components.demandAnchors = 35))),
    ).toThrow(/total 105, not 100/);
  });

  it("refuses service-gap parts that do not add up to the component", () => {
    expect(() =>
      parseScoreModel(mutate((m) => (m.weights.serviceGap.ratingGapPoints = 10))),
    ).toThrow(/service-gap parts total 22, not 20/);
  });

  it("refuses market-proof parts that do not add up to the component", () => {
    expect(() =>
      parseScoreModel(mutate((m) => (m.weights.marketProof.totalReviewsPoints = 10))),
    ).toThrow(/market-proof parts total 16, not 15/);
  });

  it("refuses a zero-competitor cap above the component's own budget", () => {
    expect(() =>
      parseScoreModel(mutate((m) => (m.weights.saturation.zeroCompetitorCap = 25))),
    ).toThrow(/exceeds the 20 points/);
  });

  it("refuses inverted verdict bands", () => {
    expect(() =>
      parseScoreModel(mutate((m) => (m.weights.verdictBands = { proceed: 40, investigate: 70 }))),
    ).toThrow(/proceed band \(40\) sits below/);
  });

  it("refuses inverted confidence thresholds", () => {
    expect(() =>
      parseScoreModel(mutate((m) => (m.weights.confidence.lowAtPenalty = 1))),
    ).not.toThrow();
    expect(() =>
      parseScoreModel(
        mutate((m) => {
          m.weights.confidence.lowAtPenalty = 1;
          m.weights.confidence.mediumAtPenalty = 3;
        }),
      ),
    ).toThrow(/low-confidence threshold sits below/);
  });

  it("rejects an unknown key rather than ignoring it", () => {
    // A typo'd weight silently ignored is a weight that never took effect.
    const withTypo = plainV1();
    (withTypo.weights as Record<string, unknown>).competitiveSaturationn = 20;
    expect(() => parseScoreModel(withTypo)).toThrow(InvalidScoreModelError);
  });

  it("names the offending path in the error, so an admin can fix it", () => {
    const broken = plainV1();
    (broken.weights as Record<string, Record<string, unknown>>).anchors!.curveX0 = -3;
    expect(() => parseScoreModel(broken)).toThrow(/anchors\.curveX0/);
  });

  it("rejects a non-object outright", () => {
    expect(() => parseScoreModel(null)).toThrow(InvalidScoreModelError);
    expect(() => parseScoreModel("1.0.0")).toThrow(InvalidScoreModelError);
  });
});
