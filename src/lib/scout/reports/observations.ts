/**
 * Computed observations — carried forward from v16's `buildAreaReport`, which
 * got this right: every observation is derived from the scan on the page above
 * it, and **cites its own numbers**, so a reader can check the sentence
 * against the table.
 *
 * Upgraded here with the three things v16 did not have: the saturation figure
 * against the city benchmark (with the benchmark's sample count, always), the
 * complaint themes drawn from real review text, and the operating windows the
 * competition holds.
 *
 * ## The vocabulary this file may not use
 *
 * No population, resident, density or per-capita wording, in any form,
 * including a denial — `docs/PHASE-3-HANDOFF.md` §6. No revenue, ROI, payback
 * or currency wording. `reportContent.test.ts` walks every string this module
 * can emit and fails on either set. The disclosure belongs to
 * `POPULATION_LIMITATION_TEXT`, printed once, in the limitations section.
 *
 * Pure: plain data in, sentences out.
 */

import { atLeast, formatCount, formatDistance } from "@/lib/scout/display/format";

export interface ObservationCategory {
  readonly categoryId: string;
  readonly label: string;
  readonly side: "competition" | "demand";
  readonly count: number;
  readonly saturated: boolean;
  readonly reviewTotal: number;
  readonly nearestM: number | null;
}

export interface ObservationPlace {
  readonly name: string;
  readonly side: "competition" | "demand";
  readonly categories: readonly string[];
  readonly distanceM: number;
  readonly rating: number | null;
  readonly reviewCount: number | null;
  readonly closesLate: boolean;
  readonly opensEarly: boolean;
}

export interface ObservationSaturation {
  readonly anchorsPerFacility: number | null;
  readonly benchmarkAnchorsPerFacility: number | null;
  readonly benchmarkCity: string | null;
  readonly benchmarkSampleCount: number;
  readonly standing: string | null;
}

export interface ObservationTheme {
  readonly label: string;
  readonly venueCount: number;
  readonly mentionCount: number;
}

export interface ObservationInput {
  readonly radiusM: number;
  readonly categories: readonly ObservationCategory[];
  readonly places: readonly ObservationPlace[];
  readonly competitionCount: number;
  readonly reviewTotal: number;
  readonly avgRating: number | null;
  readonly anySaturated: boolean;
  readonly saturation: ObservationSaturation | null;
  readonly themes: readonly ObservationTheme[];
  readonly reviewedCompetitors: number;
}

/** Below this the market is being under-served on quality, not just on supply. */
const RATING_WEDGE_BELOW = 4.2;
/** A single venue holding this share of reviews is the pocket's clear leader. */
const LEADER_SHARE = 0.6;

function radiusKm(radiusM: number): string {
  const km = radiusM / 1000;
  return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
}

export function buildObservations(input: ObservationInput): string[] {
  const out: string[] = [];
  const competition = input.categories.filter((c) => c.side === "competition");
  const facilities = input.places.filter((p) => p.side === "competition");
  const demand = input.places.filter((p) => p.side === "demand");

  /* ------------------------------------------- an unserved format is the
     single most actionable sentence the scan can produce. */
  for (const category of competition) {
    if (category.count > 0) continue;
    out.push(
      `The scan found no Google-listed ${category.label.toLowerCase()} within ${radiusKm(input.radiusM)}. ` +
        `That is either an unserved format or operators without a Google Business Profile — ` +
        `a ground check settles which, and the two lead to opposite decisions.`,
    );
  }

  /* --------------------------------------------------- a dominant venue */
  for (const category of competition) {
    if (category.count < 2 || category.reviewTotal <= 0) continue;
    const inCategory = facilities
      .filter((p) => p.categories.includes(category.categoryId))
      .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
    const leader = inCategory[0];
    if (!leader || !leader.reviewCount) continue;
    const share = leader.reviewCount / category.reviewTotal;
    if (share < LEADER_SHARE) continue;
    out.push(
      `${leader.name} holds ${Math.round(share * 100)}% of all ${category.label.toLowerCase()} review volume ` +
        `in this radius (${formatCount(leader.reviewCount)} of ${formatCount(category.reviewTotal)}). ` +
        `This pocket has one clear incumbent, and its customers are the ones a new facility has to win.`,
    );
  }

  /* ----------------------------------------------------- quality wedge */
  if (facilities.length >= 2 && input.avgRating !== null && input.avgRating < RATING_WEDGE_BELOW) {
    out.push(
      `The average rating across ${atLeast(input.competitionCount, input.anySaturated)} Google-listed facilities ` +
        `is ${input.avgRating.toFixed(1)}. Customers here are not fully satisfied by what exists, ` +
        `so service quality is a realistic way in rather than price alone.`,
    );
  }

  /* --------------------------------------------- demand closer than supply */
  if (facilities.length > 0 && demand.length > 0) {
    const nearestFacility = Math.min(...facilities.map((p) => p.distanceM));
    const nearestDemand = Math.min(...demand.map((p) => p.distanceM));
    if (nearestDemand < nearestFacility) {
      out.push(
        `The nearest demand anchor sits ${formatDistance(nearestDemand)} from the site, closer than the ` +
          `nearest competing facility at ${formatDistance(nearestFacility)}. The ground immediately around ` +
          `the plot is currently unserved at walking range.`,
      );
    }
  }

  /* ------------------------------------------------------- market proof */
  if (facilities.length > 0 && input.reviewTotal > 0) {
    const perFacility = Math.round(input.reviewTotal / facilities.length);
    out.push(
      `${atLeast(input.competitionCount, input.anySaturated)} facilities carry ${formatCount(input.reviewTotal)} ` +
        `reviews between them, ${formatCount(perFacility)} each on average. Review volume is the evidence ` +
        `that people in this radius already pay to play; it is not measured footfall.`,
    );
  }

  /* -------------------------------------------------------- saturation */
  const sat = input.saturation;
  if (sat && sat.anchorsPerFacility !== null) {
    const figure = `one Google-listed facility per ${sat.anchorsPerFacility.toFixed(1)} weighted demand anchors`;
    if (sat.benchmarkAnchorsPerFacility !== null && sat.benchmarkSampleCount > 0) {
      out.push(
        `On weighted demand anchors the catchment runs at ${figure}, against a ` +
          `${sat.benchmarkCity ?? "city"} median of one per ${sat.benchmarkAnchorsPerFacility.toFixed(1)} ` +
          `(that benchmark rests on ${sat.benchmarkSampleCount} scan${sat.benchmarkSampleCount === 1 ? "" : "s"}). ` +
          `This area is ${sat.standing ?? "comparable with"} the rest of the city.`,
      );
    } else {
      out.push(
        `On weighted demand anchors the catchment runs at ${figure}. There is no city benchmark to ` +
          `compare it against yet, so the figure stands on its own rather than as a ranking.`,
      );
    }
  }

  /* ------------------------------------------ what customers complain about */
  const recurring = input.themes.filter((t) => t.venueCount >= 2);
  if (recurring.length > 0) {
    const top = recurring[0]!;
    out.push(
      `${top.label} is the complaint that recurs most across the competition — raised at ` +
        `${top.venueCount} of ${input.reviewedCompetitors} facilities whose reviews were read, ` +
        `${formatCount(top.mentionCount)} time${top.mentionCount === 1 ? "" : "s"} in total. ` +
        `Verbatim quotes are printed in the competition section.`,
    );
  }

  /* ------------------------------------------------- the evening window */
  if (facilities.length >= 2) {
    const late = facilities.filter((p) => p.closesLate).length;
    if (late === 0) {
      out.push(
        `None of the competing facilities is listed as open at or after 22:00. The 7–11 pm slot is ` +
          `the one working adults can use, and on Google's hours nobody here is holding all of it.`,
      );
    } else if (late < facilities.length) {
      out.push(
        `${late} of ${facilities.length} competing facilities are listed as open at or after 22:00. ` +
          `The rest close before the end of the evening slot, on Google's own hours.`,
      );
    }
  }

  return out;
}

export const OBSERVATIONS_NOTE =
  "Each observation above is computed from the scan printed in this report and cites its own " +
  "figures. Crowd behaviour, peak timings, road width and parking are not knowable from listing " +
  "data — they belong to the ground visit, recorded below where one was made.";
