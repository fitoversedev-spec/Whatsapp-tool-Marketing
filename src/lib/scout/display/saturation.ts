/**
 * Reading the saturation figure out of a `ScoreResult`.
 *
 * Component 2 already carries every number the panel prints, in its `inputs`
 * audit trail. Re-deriving them from the scan would produce a second
 * implementation that eventually disagrees with the one the score was computed
 * from — and the panel would then be quoting a figure the justification
 * sentence beside it contradicts.
 */

import type { ScoreResult } from "@/lib/scout/scoring/types";

export interface SaturationFigures {
  readonly facilityCount: number | null;
  readonly weightedAnchorTotal: number | null;
  /** Weighted demand anchors served by each facility. Higher = less served. */
  readonly anchorsPerFacility: number | null;
  readonly benchmarkAnchorsPerFacility: number | null;
  readonly benchmarkCity: string | null;
  /**
   * How many scans the benchmark rests on.
   *
   * Printed every time, at the same weight as the benchmark itself. Three
   * scans is a guess; forty is data, and a reader cannot tell which they are
   * looking at unless the number is on the page.
   */
  readonly benchmarkSampleCount: number;
  /** True when no city benchmark existed and the model's default was used. */
  readonly benchmarkIsModelDefault: boolean;
  readonly ratioToBenchmark: number | null;
  readonly justification: string;
  readonly points: number;
  readonly available: number;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function saturationFigures(score: ScoreResult): SaturationFigures | null {
  const component = score.components.find((c) => c.id === "competitive-saturation");
  if (!component) return null;
  const i = component.inputs;

  return {
    facilityCount: num(i.facilityCount),
    weightedAnchorTotal: num(i.weightedAnchorTotal),
    anchorsPerFacility: num(i.anchorsPerFacility),
    benchmarkAnchorsPerFacility: num(i.benchmarkAnchorsPerFacility),
    benchmarkCity: typeof i.benchmarkCity === "string" ? i.benchmarkCity : null,
    benchmarkSampleCount: num(i.benchmarkSampleCount) ?? 0,
    benchmarkIsModelDefault: i.benchmarkIsModelDefault === true || i.benchmarkAnchorsPerFacility === null,
    ratioToBenchmark: num(i.ratioToBenchmark),
    justification: component.justification,
    points: component.points,
    available: component.available,
  };
}

/**
 * How the catchment compares with its city, in one word.
 *
 * `null` when there is nothing honest to say — no facilities, or no anchors to
 * divide by. "Average" would be a claim; silence is not.
 */
export function saturationStanding(
  figures: SaturationFigures,
): "less served than" | "in line with" | "more served than" | null {
  if (figures.ratioToBenchmark === null) return null;
  if (figures.ratioToBenchmark >= 1.15) return "less served than";
  if (figures.ratioToBenchmark <= 0.85) return "more served than";
  return "in line with";
}

/** πr² for the catchment, in km². Real, and the one geometric figure we have. */
export function catchmentAreaKm2(radiusM: number): number {
  return Math.PI * (radiusM / 1000) ** 2;
}
