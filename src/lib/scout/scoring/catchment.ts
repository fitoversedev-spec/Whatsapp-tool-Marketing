/**
 * Derivations every component shares, computed once.
 *
 * Two rules from `docs/PHASE-1-HANDOFF.md` are enforced here rather than
 * repeated in five places:
 *
 * - **`null` is not zero.** A Pro-tier search returns no `rating` and no
 *   `reviewCount`. Narrowing happens here; nothing downstream sees a coerced
 *   value, so nothing downstream can quietly average a missing rating as 0.
 * - **A permanently closed venue is not competition.** Google keeps returning
 *   it; counting it would credit a catchment with supply that no longer
 *   exists, and would inflate the denominator argument in both directions.
 */

import { median } from "./curves";
import type { ScoreInput, ScoreInputPlace } from "./types";

/** Google's `businessStatus` for a venue that has shut for good. */
const CLOSED_PERMANENTLY = "CLOSED_PERMANENTLY";

export function isOperational(place: ScoreInputPlace): boolean {
  // `null` means "not fetched at this SKU tier", which is not evidence of
  // closure — treat it as open, and let the places table show what is known.
  return place.businessStatus !== CLOSED_PERMANENTLY;
}

export interface Catchment {
  /** Operational competition-side places. The supply the score argues about. */
  readonly competitors: readonly ScoreInputPlace[];
  /** Competitors Google gave a rating for. */
  readonly ratedCompetitors: readonly ScoreInputPlace[];
  /** Competitors with at least one review. */
  readonly reviewedCompetitors: readonly ScoreInputPlace[];
  readonly competitorCount: number;
  readonly permanentlyClosedCount: number;
  /** Sum of review counts across competitors. Missing counts contribute nothing. */
  readonly reviewTotal: number;
  /** Mean rating across rated competitors, or `null` when none are rated. */
  readonly avgRating: number | null;
  /** Median reviews per reviewed competitor, or `null`. */
  readonly medianReviewsPerFacility: number | null;
  readonly nearestCompetitorM: number | null;
}

export function deriveCatchment(input: ScoreInput): Catchment {
  const competitionSide = input.places.filter((p) => p.side === "competition");
  const competitors = competitionSide.filter(isOperational);
  const ratedCompetitors = competitors.filter(
    (p) => typeof p.rating === "number" && p.rating > 0,
  );
  const reviewedCompetitors = competitors.filter(
    (p) => typeof p.reviewCount === "number" && p.reviewCount > 0,
  );

  const reviewTotal = competitors.reduce((sum, p) => sum + (p.reviewCount ?? 0), 0);
  const avgRating =
    ratedCompetitors.length > 0
      ? ratedCompetitors.reduce((s, p) => s + (p.rating ?? 0), 0) / ratedCompetitors.length
      : null;

  const nearest = competitors.reduce<number | null>(
    (best, p) => (best === null || p.distanceM < best ? p.distanceM : best),
    null,
  );

  return {
    competitors,
    ratedCompetitors,
    reviewedCompetitors,
    competitorCount: competitors.length,
    permanentlyClosedCount: competitionSide.length - competitors.length,
    reviewTotal,
    avgRating,
    medianReviewsPerFacility: median(reviewedCompetitors.map((p) => p.reviewCount ?? 0)),
    nearestCompetitorM: nearest,
  };
}
