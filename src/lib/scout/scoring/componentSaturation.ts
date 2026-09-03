/**
 * Component 2 — **competitive saturation**, 20 points.
 *
 * ## The denominator, and what it is not
 *
 * Supply is measured against the **weighted demand-anchor total from component
 * 1** — never against area. Facilities per km² is close to meaningless: a
 * square kilometre of lake and a square kilometre of apartments score
 * identically, and a report built on that would recommend a reservoir.
 * Per-100,000-residents was the right denominator and needs population data
 * this build does not have (`docs/PHASE-2-HANDOFF.md`).
 *
 * So the sentence a salesperson says is:
 *
 * > "Six Google-listed facilities serving 38 weighted demand anchors is one per
 * > 6.3, against a Bengaluru median of one per 4.1 (benchmark from 24 scans)."
 *
 * Note what it does not say. No population, no residents, no density. Any
 * justification implying otherwise is a defect, and a test asserts their
 * absence across every string this module emits.
 *
 * ## Why zero competitors is not a free 20
 *
 * An unserved gap and an unviable location look identical from competitor
 * count alone. So zero caps at 16/20 and raises a flag, and the remaining
 * argument is carried by component 3: empty ground scores high here and near
 * zero on market proof, and that combination is the "no market here" signal
 * that stops the tool recommending a field in the middle of nowhere.
 */

import { formatNumber, plural, round, saturating } from "./curves";
import type { Catchment } from "./catchment";
import type { ScoreModel } from "./model";
import type { ComponentScore, ScoreFlag, ScoreInput } from "./types";

export interface SaturationOutcome {
  readonly component: ComponentScore;
  /** Weighted anchors per Google-listed facility, or `null` with no facilities. */
  readonly anchorsPerFacility: number | null;
  /** Observed ÷ benchmark. Above 1 means less saturated than the city. */
  readonly ratio: number | null;
  readonly usedFallbackBenchmark: boolean;
}

export function scoreCompetitiveSaturation(
  input: ScoreInput,
  model: ScoreModel,
  catchment: Catchment,
  weightedAnchorTotal: number,
): SaturationOutcome {
  const available = model.weights.components.competitiveSaturation;
  const cfg = model.weights.saturation;
  const flags: ScoreFlag[] = [];

  const facilities = catchment.competitorCount;
  const benchmarkValue = input.benchmark?.anchorsPerFacility ?? null;
  const usedFallbackBenchmark = benchmarkValue === null || benchmarkValue <= 0;
  const reference = usedFallbackBenchmark ? cfg.fallbackAnchorsPerFacility : benchmarkValue;

  /* ------------------------------------------------ zero competitors */

  if (facilities === 0) {
    const points = round(Math.min(cfg.zeroCompetitorCap, available), 2);
    flags.push({
      code: "saturation_zero_competitors",
      severity: "warning",
      component: "competitive-saturation",
      message:
        `No Google-listed competing facility was found in the catchment, so this component is capped at ` +
        `${formatNumber(points, 0)} of ${formatNumber(available, 0)} rather than scoring full marks. ` +
        `An unserved opportunity and an unviable location look the same from competitor count alone — ` +
        `the market proof component is what separates them.`,
    });
    return {
      component: {
        id: "competitive-saturation",
        label: "Competitive saturation",
        points,
        available,
        included: true,
        inputs: {
          facilityCount: 0,
          weightedAnchorTotal,
          anchorsPerFacility: null,
          benchmarkAnchorsPerFacility: usedFallbackBenchmark ? null : reference,
          benchmarkCity: input.benchmark?.city ?? null,
          benchmarkSampleCount: input.benchmark?.sampleCount ?? 0,
          zeroCompetitorCapApplied: true,
        },
        justification:
          `${formatNumber(points, 1)}/${formatNumber(available, 0)} — no Google-listed competing facility ` +
          `was found within the scan radius. Absence of competition is capped at ` +
          `${formatNumber(points, 0)} points rather than scored as ideal, because it is equally consistent ` +
          `with an area nobody has served and one nobody can trade in.`,
        parts: [],
        flags,
      },
      anchorsPerFacility: null,
      ratio: null,
      usedFallbackBenchmark,
    };
  }

  /* ------------------------------------- too few anchors to divide by */

  const anchorsPerFacility = round(weightedAnchorTotal / facilities, 2);

  if (weightedAnchorTotal < cfg.minAnchorWeightForRatio) {
    const points = 0;
    flags.push({
      code: "saturation_no_anchor_base",
      severity: "warning",
      component: "competitive-saturation",
      message:
        `The weighted demand-anchor total (${formatNumber(weightedAnchorTotal, 1)}) is too small to divide ` +
        `by. Saturation is reported as zero rather than computed from a figure that would swing on one ` +
        `place either way.`,
    });
    return {
      component: {
        id: "competitive-saturation",
        label: "Competitive saturation",
        points,
        available,
        included: true,
        inputs: {
          facilityCount: facilities,
          weightedAnchorTotal,
          anchorsPerFacility,
          benchmarkAnchorsPerFacility: usedFallbackBenchmark ? null : reference,
          benchmarkCity: input.benchmark?.city ?? null,
          benchmarkSampleCount: input.benchmark?.sampleCount ?? 0,
          zeroCompetitorCapApplied: false,
        },
        justification:
          `0/${formatNumber(available, 0)} — ${plural(facilities, "Google-listed facility serves", "Google-listed facilities serve")} ` +
          `a weighted demand-anchor total of only ${formatNumber(weightedAnchorTotal, 1)}. There is not ` +
          `enough measured demand in the catchment for a saturation figure to mean anything.`,
        parts: [],
        flags,
      },
      anchorsPerFacility,
      ratio: null,
      usedFallbackBenchmark,
    };
  }

  /* ------------------------------------------------- the normal case */

  const ratio = round(anchorsPerFacility / reference, 4);
  const points = round(saturating(ratio, cfg.ratioCurveX0, available), 2);

  if (usedFallbackBenchmark) {
    flags.push({
      code: "saturation_no_city_benchmark",
      severity: "warning",
      component: "competitive-saturation",
      message:
        (input.city
          ? `No ${input.city} benchmark exists yet. `
          : `The scan's city could not be resolved, so no city benchmark applies. `) +
        `Saturation is measured against the model's stated default of one facility per ` +
        `${formatNumber(cfg.fallbackAnchorsPerFacility, 1)} weighted demand anchors, which is a default, ` +
        `not a measurement. Benchmarks build themselves as the team runs more scans in the same city.`,
    });
  } else if ((input.benchmark?.sampleCount ?? 0) < cfg.indicativeBelowSampleCount) {
    flags.push({
      code: "saturation_benchmark_indicative",
      severity: "info",
      component: "competitive-saturation",
      message:
        `The ${input.benchmark?.city} benchmark is derived from ` +
        `${plural(input.benchmark?.sampleCount ?? 0, "scan", "scans")} — too few to be a city statistic. ` +
        `Treat the comparison as indicative only.`,
    });
  }

  return {
    component: {
      id: "competitive-saturation",
      label: "Competitive saturation",
      points,
      available,
      included: true,
      inputs: {
        facilityCount: facilities,
        weightedAnchorTotal,
        anchorsPerFacility,
        benchmarkAnchorsPerFacility: round(reference, 2),
        benchmarkIsModelDefault: usedFallbackBenchmark,
        benchmarkCity: input.benchmark?.city ?? null,
        benchmarkSampleCount: input.benchmark?.sampleCount ?? 0,
        ratioToBenchmark: ratio,
        permanentlyClosedExcluded: catchment.permanentlyClosedCount,
      },
      justification: justify(
        input,
        model,
        points,
        available,
        facilities,
        weightedAnchorTotal,
        anchorsPerFacility,
        reference,
        usedFallbackBenchmark,
      ),
      parts: [],
      flags,
    },
    anchorsPerFacility,
    ratio,
    usedFallbackBenchmark,
  };
}

function justify(
  input: ScoreInput,
  model: ScoreModel,
  points: number,
  available: number,
  facilities: number,
  weightedAnchorTotal: number,
  anchorsPerFacility: number,
  reference: number,
  usedFallbackBenchmark: boolean,
): string {
  const qualifier = input.anySaturated ? "at least " : "";
  const head =
    `${formatNumber(points, 1)}/${formatNumber(available, 0)} — ${qualifier}` +
    `${plural(facilities, "Google-listed facility serving", "Google-listed facilities serving")} ` +
    `${formatNumber(weightedAnchorTotal, 1)} weighted demand anchors is one per ` +
    `${formatNumber(anchorsPerFacility, 1)}`;

  if (usedFallbackBenchmark) {
    return (
      `${head}, against model ${model.version}'s stated default of one per ` +
      `${formatNumber(reference, 1)} — no city benchmark exists for this area yet.`
    );
  }

  const benchmark = input.benchmark!;
  return (
    `${head}, against a ${benchmark.city} median of one per ${formatNumber(reference, 1)} ` +
    `(benchmark from ${plural(benchmark.sampleCount, "scan", "scans")}).`
  );
}
