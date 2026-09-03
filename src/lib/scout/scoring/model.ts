/**
 * The score model — every weight, threshold and curve constant, in one typed
 * object loaded from the `score_models` row.
 *
 * **Nothing in the scoring functions may hardcode a number that belongs here.**
 * `computeScore` takes the model as a required argument and there is no
 * default, so a caller cannot accidentally score against a compiled-in copy.
 * `modelV1.ts` holds the v1.0.0 *seed data* — the same JSON that goes into the
 * database — and is imported by the seed script and the golden tests, never by
 * the scoring functions.
 *
 * ## Why this is versioned rather than editable
 *
 * A report regenerated a year from now must reproduce its original number.
 * Every scan stamps the model version it was scored with; a tuned model is a
 * new version, not an edit. When population is switched on
 * (`docs/PHASE-2-HANDOFF.md` → *Switching population on*), the saturation
 * denominator changes from weighted demand anchors to residents — that is
 * v2.0.0, and v1.0.0 keeps reproducing its own numbers untouched.
 */

import { z } from "zod";

const positive = z.number().positive();
const nonNegative = z.number().min(0);
const fraction = z.number().min(0).max(1);

/**
 * Semver, three parts. The `score_models.version` column is 20 chars and the
 * Phase 0 seed used a two-part `"1.0"`; three parts is what the brief asks for
 * and what a future `1.1.0` re-tune needs.
 */
const semver = z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver, e.g. 1.0.0");

export const scoreModelWeightsSchema = z
  .object({
    /** Points per component. Must total 100. */
    components: z.object({
      demandAnchors: nonNegative,
      competitiveSaturation: nonNegative,
      marketProof: nonNegative,
      serviceGap: nonNegative,
      sitePracticals: nonNegative,
    }),

    anchors: z.object({
      /**
       * Anchor weight by **search term id**, which is finer than the category
       * weight Phase 1 stores: a college (0.90) and a school (0.70) are both
       * `education`. Falls back to `categoryWeights`, then to `defaultWeight`.
       */
      termWeights: z.record(z.string(), nonNegative),
      categoryWeights: z.record(z.string(), nonNegative),
      /**
       * What an anchor nobody weighted contributes. **Zero**, deliberately:
       * an unrecognised place is not evidence of demand, and guessing a
       * weight for it invents demand the scan did not find.
       */
      defaultWeight: nonNegative,
      /** `D` in `w × e^(−d/D)` is `radiusM / distanceDecayDivisor`. */
      distanceDecayDivisor: positive,
      /** `x₀` in `P × (1 − e^(−x/x₀))` over the weighted anchor total. */
      curveX0: positive,
    }),

    saturation: z.object({
      /**
       * Used when the city has no benchmark yet. Not a statistic — a stated
       * default the justification names as such.
       */
      fallbackAnchorsPerFacility: positive,
      /**
       * `x₀` over the ratio (our anchors-per-facility ÷ the benchmark's).
       * `1/ln2` puts a catchment exactly on the city median at half marks.
       */
      ratioCurveX0: positive,
      /** Zero competitors is not a free 20. Cap, and raise a flag. */
      zeroCompetitorCap: nonNegative,
      /**
       * Below this weighted anchor total the ratio is arithmetic noise —
       * a handful of anchors divided by one facility swings wildly.
       */
      minAnchorWeightForRatio: nonNegative,
      /** Benchmarks from fewer scans than this are indicative only. */
      indicativeBelowSampleCount: nonNegative,
    }),

    marketProof: z.object({
      totalReviewsPoints: nonNegative,
      totalReviewsX0: positive,
      perFacilityPoints: nonNegative,
      perFacilityX0: positive,
    }),

    serviceGap: z.object({
      ratingGapPoints: nonNegative,
      /** The rating a well-run new facility can reach. The gap is measured to here. */
      ratingBaseline: z.number().min(0).max(5),
      ratingGapX0: positive,
      /** Fewer rated competitors than this and the rating gap is not evidence. */
      minRatedFacilities: nonNegative,

      concentrationPoints: nonNegative,

      unservedSportsPoints: nonNegative,
      unservedSportsX0: positive,

      complaintThemePoints: nonNegative,
      /** Share of reviewed competitors drawing the same complaint for full marks. */
      complaintShareForFullPoints: fraction,
      minCompetitorsWithThemes: nonNegative,
    }),

    practicals: z.object({
      /** Per-field weight within the component, keyed by checklist field id. */
      fieldWeights: z.record(z.string(), nonNegative),
      /**
       * Fields whose rating at or below the given value raises a **hard flag**
       * that surfaces on the report regardless of the total score. Empty is a
       * valid configuration; adding one is a model edit, not a code change.
       */
      hardFlagAtOrBelow: z.record(z.string(), z.number().int().min(0).max(3)),
      /**
       * Below this many answered fields the component is excluded and the
       * score becomes `desk_only`. Two ticked boxes are not a site survey.
       */
      minAnsweredFields: z.number().int().min(1),
    }),

    verdictBands: z.object({
      /** `total >= proceed` → proceed. */
      proceed: nonNegative,
      /** `total >= investigate` → investigate, else avoid. */
      investigate: nonNegative,
    }),

    confidence: z.object({
      /** Penalty ≥ this → low. */
      lowAtPenalty: z.number().int().min(1),
      /** Penalty ≥ this (and < low) → medium. */
      mediumAtPenalty: z.number().int().min(1),
      minCompetitorsWithReviews: nonNegative,
      minBenchmarkSampleCount: nonNegative,
      /**
       * Penalty applied because model v1.0 has no population base.
       * **Zero in v1.0.0.** The absence of population is a constant of this
       * model, not something that varies between scans, so expressing it as
       * confidence would flatten the signal to no purpose — it is disclosed
       * in the limitations text instead, and listed in `confidence.reasons`.
       */
      populationUnavailablePenalty: z.number().int().min(0),
    }),
  })
  .strict();

export type ScoreModelWeights = z.infer<typeof scoreModelWeightsSchema>;

export const scoreModelSchema = z
  .object({
    version: semver,
    name: z.string().min(1),
    description: z.string().default(""),
    includesPopulation: z.boolean(),
    weights: scoreModelWeightsSchema,
  })
  .strict();

export type ScoreModel = z.infer<typeof scoreModelSchema>;

export class InvalidScoreModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScoreModelError";
  }
}

/**
 * Validate a model, including the cross-field rules a schema cannot express.
 *
 * Throws rather than repairing. A model whose components do not total 100 is a
 * configuration mistake, and a score computed from it would be quietly wrong
 * on every report until somebody noticed the arithmetic.
 */
export function parseScoreModel(raw: unknown): ScoreModel {
  const parsed = scoreModelSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidScoreModelError(
      `Score model is not valid: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const model = parsed.data;
  const w = model.weights;

  const total =
    w.components.demandAnchors +
    w.components.competitiveSaturation +
    w.components.marketProof +
    w.components.serviceGap +
    w.components.sitePracticals;
  if (Math.abs(total - 100) > 1e-9) {
    throw new InvalidScoreModelError(
      `Score model ${model.version}: component points total ${total}, not 100.`,
    );
  }

  const gapTotal =
    w.serviceGap.ratingGapPoints +
    w.serviceGap.concentrationPoints +
    w.serviceGap.unservedSportsPoints +
    w.serviceGap.complaintThemePoints;
  if (Math.abs(gapTotal - w.components.serviceGap) > 1e-9) {
    throw new InvalidScoreModelError(
      `Score model ${model.version}: service-gap parts total ${gapTotal}, not ${w.components.serviceGap}.`,
    );
  }

  const proofTotal = w.marketProof.totalReviewsPoints + w.marketProof.perFacilityPoints;
  if (Math.abs(proofTotal - w.components.marketProof) > 1e-9) {
    throw new InvalidScoreModelError(
      `Score model ${model.version}: market-proof parts total ${proofTotal}, not ${w.components.marketProof}.`,
    );
  }

  if (w.saturation.zeroCompetitorCap > w.components.competitiveSaturation) {
    throw new InvalidScoreModelError(
      `Score model ${model.version}: zeroCompetitorCap ${w.saturation.zeroCompetitorCap} exceeds the ` +
        `${w.components.competitiveSaturation} points the component can award.`,
    );
  }

  if (w.verdictBands.proceed < w.verdictBands.investigate) {
    throw new InvalidScoreModelError(
      `Score model ${model.version}: the proceed band (${w.verdictBands.proceed}) sits below the ` +
        `investigate band (${w.verdictBands.investigate}).`,
    );
  }

  if (w.confidence.lowAtPenalty < w.confidence.mediumAtPenalty) {
    throw new InvalidScoreModelError(
      `Score model ${model.version}: the low-confidence threshold sits below the medium one.`,
    );
  }

  return model;
}
