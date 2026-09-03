/**
 * Component 3 — **market proof**, 15 points.
 *
 * Review volume is the only evidence in the scan that someone has actually
 * paid to play in this catchment. People do not review places they have not
 * been to, and they review sports venues after a booking rather than after
 * walking past one.
 *
 * Split two ways on purpose:
 *
 * - **Total volume (9)** — breadth. Is there a market here at all?
 * - **Median per facility (6)** — depth. Ten venues with four reviews each is
 *   a different market from two venues with two hundred, and the total alone
 *   cannot tell them apart.
 *
 * Median rather than mean, because one flagship venue with 900 reviews should
 * not make five struggling ones look busy.
 *
 * **This component is what stops the tool recommending farmland.** Empty ground
 * scores high on competitive saturation (nobody is competing) and near zero
 * here (nobody is paying), and the two together are the "no market" signal.
 */

import { formatCount, formatNumber, plural, round, saturating } from "./curves";
import type { Catchment } from "./catchment";
import type { ScoreModel } from "./model";
import type { ComponentScore, ScoreFlag } from "./types";

export interface MarketProofOutcome {
  readonly component: ComponentScore;
}

export function scoreMarketProof(
  model: ScoreModel,
  catchment: Catchment,
): MarketProofOutcome {
  const available = model.weights.components.marketProof;
  const cfg = model.weights.marketProof;
  const flags: ScoreFlag[] = [];

  const totalReviews = catchment.reviewTotal;
  const medianPerFacility = catchment.medianReviewsPerFacility ?? 0;

  const totalPoints = round(
    saturating(totalReviews, cfg.totalReviewsX0, cfg.totalReviewsPoints),
    2,
  );
  const perFacilityPoints = round(
    saturating(medianPerFacility, cfg.perFacilityX0, cfg.perFacilityPoints),
    2,
  );
  const points = round(totalPoints + perFacilityPoints, 2);

  if (catchment.competitorCount > 0 && catchment.reviewedCompetitors.length === 0) {
    flags.push({
      code: "market_proof_no_reviews",
      severity: "warning",
      component: "market-proof",
      message:
        `${plural(catchment.competitorCount, "facility was", "facilities were")} found but none carries a ` +
        `Google review count. Either they are new, or review data was not returned at the search tier used. ` +
        `The market-proof score should be read as unmeasured rather than as evidence of no demand.`,
    });
  }

  return {
    component: {
      id: "market-proof",
      label: "Market proof",
      points,
      available,
      included: true,
      inputs: {
        totalReviews,
        facilityCount: catchment.competitorCount,
        reviewedFacilityCount: catchment.reviewedCompetitors.length,
        medianReviewsPerFacility: round(medianPerFacility, 1),
        totalReviewsX0: cfg.totalReviewsX0,
        perFacilityX0: cfg.perFacilityX0,
      },
      justification: justify(
        points,
        available,
        totalReviews,
        catchment.competitorCount,
        catchment.reviewedCompetitors.length,
        medianPerFacility,
      ),
      parts: [
        {
          id: "total-volume",
          label: "Total review volume",
          points: totalPoints,
          available: cfg.totalReviewsPoints,
          detail: `${formatCount(totalReviews)} reviews across all Google-listed facilities in the catchment`,
        },
        {
          id: "per-facility",
          label: "Reviews per facility",
          points: perFacilityPoints,
          available: cfg.perFacilityPoints,
          detail:
            catchment.reviewedCompetitors.length > 0
              ? `median of ${formatNumber(medianPerFacility, 0)} across ${plural(catchment.reviewedCompetitors.length, "reviewed facility", "reviewed facilities")}`
              : "no facility in the catchment carries a review count",
        },
      ],
      flags,
    },
  };
}

function justify(
  points: number,
  available: number,
  totalReviews: number,
  facilities: number,
  reviewedFacilities: number,
  medianPerFacility: number,
): string {
  const head = `${formatNumber(points, 1)}/${formatNumber(available, 0)} — `;

  if (facilities === 0) {
    return (
      head +
      "no Google-listed facility was found in the catchment, so there is no review evidence that " +
      "anyone is currently paying to play here."
    );
  }
  if (reviewedFacilities === 0) {
    return (
      head +
      `${plural(facilities, "Google-listed facility was", "Google-listed facilities were")} found, but ` +
      `none carries a review count, so there is no measurable evidence of paid use.`
    );
  }
  return (
    head +
    `${formatCount(totalReviews)} Google reviews across ` +
    `${plural(facilities, "listed facility", "listed facilities")}, a median of ` +
    `${formatNumber(medianPerFacility, 0)} per reviewed facility. Reviews follow bookings, so this is ` +
    `the scan's evidence that people already pay to play in this catchment.`
  );
}
