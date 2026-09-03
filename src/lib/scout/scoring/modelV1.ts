/**
 * Score model **v1.0.0** — the seed data for the `score_models` row.
 *
 * This file is *data*. It is imported by the seed script, by the golden tests
 * and by the integration test that proves the database row matches it. It is
 * **not** imported by any scoring function: `computeScore` takes the model as
 * a required argument, loaded from the database, so a tuned model reaches
 * production by a row change and a version bump rather than a deploy.
 *
 * Every number below traces to `plan/IMPLEMENTATION-PLAN.md` §4 or is a
 * reasoned default recorded in `docs/PHASE-3-HANDOFF.md`. Reasoned defaults are
 * not calibrated values — the client's D4 answer (ten known sites, ranked by
 * gut) is what turns them into calibrated ones, and until it arrives the
 * component breakdown is what makes a wrong weight visible.
 *
 * ## Model v1.0 has no population base
 *
 * `getCatchmentProfile` returns `{ available: false }` in this build, so the
 * saturation denominator is the weighted demand-anchor total from component 1,
 * not residents and never facilities per km² — a km² of lake and a km² of
 * apartments score identically, which is why that fallback was rejected.
 * Reinstating population is v2.0.0.
 */

import type { ScoreModel } from "./model";

/**
 * Anchor weight by search-term id.
 *
 * Finer-grained than the per-category `anchorWeight` Phase 1 stores, because
 * §4's table is finer: a college is 0.90 and a school 0.70, yet both are the
 * `education` category. Category weights below are the fallback for a term
 * added to the taxonomy without a weight of its own.
 *
 * Only **demand-side** places contribute. §4 lists "sports coaching / academy"
 * at 0.60, but the taxonomy classifies academies as competition
 * (`adjacent-fitness`), and counting the same venue as both supply and the
 * demand it is measured against would flatter every saturated catchment. The
 * weight is kept here so a future taxonomy that moves academies to the demand
 * side needs no code change; today it never fires. Recorded in the handoff.
 */
const TERM_WEIGHTS: Record<string, number> = {
  /* Workplaces — own the 7–11 pm weekday peak, least price-sensitive. */
  "tech-park": 1.0,
  "office-complex": 1.0,
  coworking: 1.0,
  /* Colleges and universities — evenings and weekends, high volume. */
  college: 0.9,
  university: 0.9,
  /* Apartments and gated communities — weekend mornings, family memberships. */
  "apartment-complex": 0.8,
  "gated-community": 0.8,
  /* Schools — 4–6 pm weekdays, plus academy contracts. */
  school: 0.7,
  "international-school": 0.7,
  /* Sports coaching — partner or competitor by format. See the note above. */
  "sports-academy": 0.6,
  /* Hostels — volume, low spend. */
  hostel: 0.5,
  /* Transit — an accessibility multiplier more than demand in its own right. */
  "metro-station": 0.4,
  "bus-terminal": 0.4,
  /* Cafés, malls, restaurants, hotels — footfall proxy only. */
  cafe: 0.2,
  restaurant: 0.2,
  mall: 0.2,
  hotel: 0.2,
};

/** Fallback when a term carries no weight of its own. Mirrors `taxonomy.ts`. */
const CATEGORY_WEIGHTS: Record<string, number> = {
  workplaces: 1.0,
  residential: 0.8,
  education: 0.7,
  transit: 0.4,
  lifestyle: 0.2,
};

/**
 * Per-field weights inside component 5.
 *
 * **Even, at 1.0 each, as the brief instructs** — the client was asked which
 * of the fourteen are make-or-break and had not answered when this shipped.
 * The mechanism is here and live: change these numbers in the `score_models`
 * row, publish a new version, and the component reweights with no code change.
 *
 * The separate `hardFlagAtOrBelow` map is what handles the case that even
 * weighting genuinely gets wrong. A site where evening play is prohibited
 * loses the whole 7–11 pm peak revenue window; that is nearer a deal-breaker
 * than a one-point deduction, and no weight expresses it, because the problem
 * is not that the site scores slightly lower — it is that the reader must see
 * the restriction whatever the total says.
 */
const FIELD_WEIGHTS: Record<string, number> = {
  "road-frontage": 1,
  parking: 1,
  visibility: 1,
  "approach-road": 1,
  "distance-to-transit": 1,
  "power-supply": 1,
  water: 1,
  drainage: 1,
  "slope-levelling": 1,
  "soil-ground": 1,
  "flood-history": 1,
  boundary: 1,
  "adjacent-residences": 1,
  "evening-play-restrictions": 1,
};

export const SCORE_MODEL_V1: ScoreModel = {
  version: "1.0.0",
  name: "Site Score v1.0 — demand anchors, no population base",
  description:
    "Population and census are deferred, so demand is carried by type-weighted, distance-decayed " +
    "anchors and competitive saturation is measured against those anchors rather than residents. " +
    "Weights are reasoned defaults from IMPLEMENTATION-PLAN §4, not values calibrated against " +
    "known sites; the component breakdown is what makes a wrong one visible.",
  includesPopulation: false,
  weights: {
    components: {
      demandAnchors: 30,
      competitiveSaturation: 20,
      marketProof: 15,
      serviceGap: 20,
      sitePracticals: 15,
    },

    anchors: {
      termWeights: TERM_WEIGHTS,
      categoryWeights: CATEGORY_WEIGHTS,
      /** An unrecognised place is not evidence of demand. */
      defaultWeight: 0,
      /** `D = radius / 2`, per §4. */
      distanceDecayDivisor: 2,
      /**
       * 16 weighted anchors awards ~63 % of 30.
       *
       * Centred on what a typical scan actually produces rather than on a
       * round number: a 2 km standard scan of a busy neighbourhood finds
       * roughly 40–60 demand places, and distance decay roughly halves their
       * combined weight, which lands near 13–19. Putting `x₀` in the middle of
       * that band spreads real sites across the component instead of bunching
       * them at one end. Genuinely empty ground is zero either way.
       */
      curveX0: 16,
    },

    saturation: {
      /**
       * Used only where the city has no benchmark yet, and the justification
       * says so in those words. Four anchors per facility is the middle of
       * what the estimator's worked examples produce; it is a stated default,
       * not a measurement.
       */
      fallbackAnchorsPerFacility: 4,
      /**
       * `1/ln 2`. A catchment sitting exactly on the city median scores half
       * the component — the property that makes the number arguable across a
       * table: "you are level with the city; you get half the marks".
       */
      ratioCurveX0: 1.4426950408889634,
      /**
       * Zero competitors caps at 16/20 with a flag. An unserved gap and an
       * unviable location look identical from competitor count alone, and the
       * missing four points are the difference the report has to name.
       */
      zeroCompetitorCap: 16,
      /**
       * Under 2 weighted anchors the ratio is arithmetic noise. Below this the
       * component reports what it found and awards the floor rather than
       * dividing a rounding error by one facility.
       */
      minAnchorWeightForRatio: 2,
      indicativeBelowSampleCount: 5,
    },

    marketProof: {
      /** Total review volume across Google-listed competitors. */
      totalReviewsPoints: 9,
      totalReviewsX0: 600,
      /** Median reviews per facility — depth, not just breadth. */
      perFacilityPoints: 6,
      perFacilityX0: 120,
    },

    serviceGap: {
      ratingGapPoints: 8,
      /**
       * 4.6 is what a well-run new facility can reach on Google in this
       * market. The gap is the distance from the incumbents' average to that,
       * which is the part a new operator can actually take.
       */
      ratingBaseline: 4.6,
      ratingGapX0: 0.5,
      minRatedFacilities: 2,

      concentrationPoints: 4,

      unservedSportsPoints: 4,
      unservedSportsX0: 2,

      complaintThemePoints: 4,
      /**
       * Half the reviewed competitors drawing the same complaint is a genuine,
       * quotable market weakness and scores full marks. One venue with a
       * parking problem is that venue's problem.
       */
      complaintShareForFullPoints: 0.5,
      minCompetitorsWithThemes: 2,
    },

    practicals: {
      fieldWeights: FIELD_WEIGHTS,
      /**
       * The one hard flag v1.0.0 ships with. Rating 0 on this field is
       * "night play prohibited" — the 7–11 pm window gone entirely. It
       * surfaces on the report regardless of the total score.
       */
      hardFlagAtOrBelow: { "evening-play-restrictions": 0 },
      /**
       * Four answered fields out of fourteen is the least that can be called
       * a site visit. Below it the component is excluded and the score is
       * `desk_only` — which is honest, and visible.
       */
      minAnsweredFields: 4,
    },

    verdictBands: { proceed: 70, investigate: 50 },

    confidence: {
      lowAtPenalty: 3,
      mediumAtPenalty: 1,
      minCompetitorsWithReviews: 2,
      minBenchmarkSampleCount: 5,
      /** Zero, deliberately — see the note in `model.ts`. */
      populationUnavailablePenalty: 0,
    },
  },
};
