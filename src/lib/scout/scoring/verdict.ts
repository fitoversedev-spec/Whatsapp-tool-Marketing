/**
 * Verdict and confidence.
 *
 * ## Verdict wording is advisory, and that is a hard constraint
 *
 * "The data supports proceeding to a ground survey" — never "this will be
 * profitable". The plan explicitly excludes revenue projection, and the
 * client's own disclaimer says the report "contains no projection of revenue
 * or return". A verdict sentence that drifted into a financial claim would
 * contradict the disclaimer printed on the same page.
 *
 * ## Why confidence is a separate axis from the score
 *
 * A 78 with low confidence and a 78 with high confidence are different
 * recommendations. The score says how good the evidence looks; the confidence
 * says how much evidence there was. Printing one without the other invites the
 * reader to treat a thin scan and a thorough one as the same finding.
 */

import type { Catchment } from "./catchment";
import type { ScoreModel } from "./model";
import { plural } from "./curves";
import type { ConfidenceResult, ScoreBasis, ScoreInput, Verdict } from "./types";

export function verdictFor(total: number, model: ScoreModel): Verdict {
  const bands = model.weights.verdictBands;
  if (total >= bands.proceed) return "proceed";
  if (total >= bands.investigate) return "investigate";
  return "avoid";
}

/** The label the UI must print beside a `desk_only` score. */
export const DESK_ONLY_LABEL = "Desk assessment — no site survey recorded";

/**
 * The advisory sentence.
 *
 * Kept in one place so the wording constraint is enforceable: a test asserts
 * that none of these strings contains a financial term, and a reviewer has one
 * function to read rather than three call sites to find.
 */
export function verdictStatement(verdict: Verdict, basis: ScoreBasis): string {
  const base =
    verdict === "proceed"
      ? "The data collected supports proceeding to a ground survey and a conversation with the land owner."
      : verdict === "investigate"
        ? "The data collected is mixed. Work through the component breakdown below before committing more time to this site."
        : "The data collected does not support this site. The component breakdown shows which parts fall short and by how much.";

  if (basis === "desk_only") {
    return (
      `${base} This is a desk assessment: no site survey has been recorded, so the score is measured ` +
      `over the remaining components and cannot be ranked against a surveyed site's score.`
    );
  }
  return base;
}

export function assessConfidence(
  input: ScoreInput,
  model: ScoreModel,
  catchment: Catchment,
  basis: ScoreBasis,
): ConfidenceResult {
  const cfg = model.weights.confidence;
  const reasons: string[] = [];
  let penalty = 0;

  if (input.anySaturated) {
    penalty += 1;
    const terms = input.saturatedTermLabels;
    reasons.push(
      terms.length > 0
        ? `Search results were truncated for ${terms.join(", ")}, so those counts are floors — read them as "at least N".`
        : `Search results were truncated for at least one term, so the counts in this scan are floors rather than totals.`,
    );
  }

  if (catchment.reviewedCompetitors.length < cfg.minCompetitorsWithReviews) {
    penalty += 1;
    reasons.push(
      `Only ${plural(catchment.reviewedCompetitors.length, "facility in the catchment carries", "facilities in the catchment carry")} ` +
        `review data, so the market-proof and service-gap components rest on thin evidence.`,
    );
  }

  const sampleCount = input.benchmark?.sampleCount ?? 0;
  if (input.benchmark === null || input.benchmark.anchorsPerFacility === null) {
    penalty += 1;
    reasons.push(
      "No city benchmark exists for this area yet, so saturation is measured against the model's stated " +
        "default rather than against other scans in the same city.",
    );
  } else if (sampleCount < cfg.minBenchmarkSampleCount) {
    penalty += 1;
    reasons.push(
      `The ${input.benchmark.city} benchmark is built from ${plural(sampleCount, "scan", "scans")}, which is ` +
        `too few to be treated as a city statistic.`,
    );
  }

  if (basis === "desk_only") {
    penalty += 1;
    reasons.push(
      "No site survey has been recorded, so the site-practicals component was excluded and the score " +
        "was measured over the remaining components.",
    );
  }

  if (!input.populationAvailable && cfg.populationUnavailablePenalty > 0) {
    penalty += cfg.populationUnavailablePenalty;
  }

  const level =
    penalty >= cfg.lowAtPenalty ? "low" : penalty >= cfg.mediumAtPenalty ? "medium" : "high";

  if (reasons.length === 0) {
    reasons.push(
      "Counts are complete, competitors carry review data, a city benchmark applies and a site survey " +
        "was recorded.",
    );
  }

  return { level, penalty, reasons };
}
