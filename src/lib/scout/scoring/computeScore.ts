/**
 * `computeScore(input, model) → ScoreResult`.
 *
 * Pure. No database, no network, no framework, no clock, no randomness. Same
 * input and same model version produce the same number, always — which is the
 * whole point of stamping every scan with its model version: a report
 * regenerated in a year reproduces its original figure rather than silently
 * re-scoring under whatever the weights have become.
 *
 * `model` is a **required argument with no default**. There is deliberately no
 * way to score against a compiled-in copy of the weights; they are loaded from
 * `score_models` by the caller.
 */

import { round } from "./curves";
import { deriveCatchment } from "./catchment";
import { scoreDemandAnchors } from "./componentAnchors";
import { scoreCompetitiveSaturation } from "./componentSaturation";
import { scoreMarketProof } from "./componentMarketProof";
import { scoreServiceGap } from "./componentServiceGap";
import { scoreSitePracticals } from "./componentPracticals";
import { CHECKLIST_VERSION } from "./checklist";
import type { ScoreModel } from "./model";
import type { ComponentScore, ScoreBasis, ScoreFlag, ScoreInput, ScoreResult } from "./types";
import { DESK_ONLY_LABEL, assessConfidence, verdictFor, verdictStatement } from "./verdict";

export class UnsupportedScoreModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedScoreModelError";
  }
}

export function computeScore(input: ScoreInput, model: ScoreModel): ScoreResult {
  /**
   * A model that declares a population base cannot be scored by this build —
   * none of the component functions has a population branch, so it would be
   * silently ignored and the report would claim a basis it did not use. Fail
   * loudly instead; reinstating population is v2.0.0 and a code change, per
   * `docs/PHASE-2-HANDOFF.md` → *Switching population on*.
   */
  if (model.includesPopulation) {
    throw new UnsupportedScoreModelError(
      `Score model ${model.version} declares a population base, which this build cannot compute. ` +
        `See docs/PHASE-2-HANDOFF.md before publishing such a model.`,
    );
  }

  const catchment = deriveCatchment(input);

  const anchors = scoreDemandAnchors(input, model);
  const demandFraction =
    anchors.component.available > 0 ? anchors.component.points / anchors.component.available : 0;

  const saturation = scoreCompetitiveSaturation(input, model, catchment, anchors.weightedTotal);
  const marketProof = scoreMarketProof(model, catchment);
  const serviceGap = scoreServiceGap(input, model, catchment, demandFraction);
  const practicals = scoreSitePracticals(input, model);

  const components: ComponentScore[] = [
    anchors.component,
    saturation.component,
    marketProof.component,
    serviceGap.component,
    practicals.component,
  ];

  const included = components.filter((c) => c.included);
  const pointsAwarded = round(
    included.reduce((sum, c) => sum + c.points, 0),
    2,
  );
  const pointsAvailable = round(
    included.reduce((sum, c) => sum + c.available, 0),
    2,
  );

  /**
   * Rescale over the components that were actually scored.
   *
   * An excluded component is removed from the denominator as well as the
   * numerator, so an unsurveyed site is not punished for being unvisited. The
   * cost of that correctness is that the two scores are no longer comparable —
   * hence `basis`, which every surface must display.
   */
  const total = pointsAvailable > 0 ? round((pointsAwarded / pointsAvailable) * 100, 2) : 0;

  const basis: ScoreBasis = practicals.component.included ? "full" : "desk_only";
  const verdict = verdictFor(total, model);
  const confidence = assessConfidence(input, model, catchment, basis);

  const flags: ScoreFlag[] = components.flatMap((c) => c.flags);

  if (input.anySaturated) {
    flags.unshift({
      code: "counts_are_floors",
      severity: "warning",
      component: null,
      message:
        input.saturatedTermLabels.length > 0
          ? `Search results were truncated for ${input.saturatedTermLabels.join(", ")}. Every count in this ` +
            `score is a floor and must be printed as "at least N", never as an exact figure.`
          : `Search results were truncated for at least one term. Every count in this score is a floor and ` +
            `must be printed as "at least N", never as an exact figure.`,
    });
  }

  if (catchment.permanentlyClosedCount > 0) {
    flags.push({
      code: "closed_competitors_excluded",
      severity: "info",
      component: null,
      message:
        `${catchment.permanentlyClosedCount} permanently closed ` +
        `${catchment.permanentlyClosedCount === 1 ? "venue was" : "venues were"} excluded from the ` +
        `competitor count. Google still lists them; they are not supply.`,
    });
  }

  return {
    total,
    totalRounded: Math.round(total),
    verdict,
    verdictStatement: verdictStatement(verdict, basis),
    basis,
    basisLabel: basis === "desk_only" ? DESK_ONLY_LABEL : "",
    components,
    pointsAvailable,
    pointsAwarded,
    confidence,
    flags,
    hardFlags: flags.filter((f) => f.severity === "hard"),
    modelVersion: model.version,
    checklistVersion: CHECKLIST_VERSION,
    countsAreExact: !input.anySaturated,
  };
}
