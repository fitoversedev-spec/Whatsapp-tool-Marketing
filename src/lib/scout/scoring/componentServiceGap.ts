/**
 * Component 4 — **service gap**, 20 points, in four parts.
 *
 * | Part | Pts | What it answers |
 * |---|---|---|
 * | Rating gap | 8 | How far short of an achievable standard the incumbents fall |
 * | Review-share concentration | 4 | Is one operator holding the whole market? |
 * | Unserved sports | 4 | A format with demand in the catchment and no supply |
 * | Complaint themes | 4 | The same complaint recurring across several venues |
 *
 * The parts share a single discipline: a gap only counts when there is
 * something to take it from. Every one of them scores zero, with a flag, when
 * the evidence is missing — because "no competitor has a rating" is not the
 * same finding as "every competitor is rated 4.6", and a component that scored
 * them alike would hand its best marks to empty ground.
 *
 * The unserved-sports part is gated on measured demand for exactly that
 * reason. In farmland every format is unserved, and without the gate this
 * component would pay four points for a market that does not exist.
 */

import { clamp, formatNumber, normalisedConcentration, plural, round, saturating } from "./curves";
import type { Catchment } from "./catchment";
import type { ScoreModel } from "./model";
import { reviewThemeComplaintPhrase } from "./themes";
import type { ComponentPart, ComponentScore, ScoreFlag, ScoreInput } from "./types";

export interface ServiceGapOutcome {
  readonly component: ComponentScore;
  /** Formats the scan searched for and found nothing of. */
  readonly unservedFormats: readonly string[];
  /** The recurring complaint, when one was found across enough venues. */
  readonly topComplaint: { theme: string; venues: number; of: number } | null;
}

export function scoreServiceGap(
  input: ScoreInput,
  model: ScoreModel,
  catchment: Catchment,
  /** Component 1's share of its own points, 0–1. The demand gate. */
  demandFraction: number,
): ServiceGapOutcome {
  const available = model.weights.components.serviceGap;
  const cfg = model.weights.serviceGap;
  const flags: ScoreFlag[] = [];
  const parts: ComponentPart[] = [];

  /* ------------------------------------------------------ rating gap */

  const ratedCount = catchment.ratedCompetitors.length;
  const avgRating = catchment.avgRating;
  let ratingPoints = 0;
  let ratingGap = 0;

  if (ratedCount >= cfg.minRatedFacilities && avgRating !== null) {
    ratingGap = Math.max(0, cfg.ratingBaseline - avgRating);
    ratingPoints = round(saturating(ratingGap, cfg.ratingGapX0, cfg.ratingGapPoints), 2);
    parts.push({
      id: "rating-gap",
      label: "Rating gap",
      points: ratingPoints,
      available: cfg.ratingGapPoints,
      detail:
        `${plural(ratedCount, "rated facility averages", "rated facilities average")} ` +
        `${formatNumber(avgRating, 2)} against an achievable ${formatNumber(cfg.ratingBaseline, 1)} — ` +
        `a gap of ${formatNumber(ratingGap, 2)}`,
    });
  } else {
    parts.push({
      id: "rating-gap",
      label: "Rating gap",
      points: 0,
      available: cfg.ratingGapPoints,
      detail:
        ratedCount === 0
          ? "no facility in the catchment carries a Google rating"
          : `only ${plural(ratedCount, "facility carries", "facilities carry")} a rating — too few to argue a gap from`,
    });
    flags.push({
      code: "service_gap_rating_unmeasured",
      severity: "warning",
      component: "service-gap",
      message:
        `The rating gap could not be measured: ${ratedCount === 0 ? "no competitor" : `only ${plural(ratedCount, "competitor", "competitors")}`} ` +
        `in the catchment carries a Google rating. Those ${formatNumber(cfg.ratingGapPoints, 0)} points were ` +
        `not awarded, and their absence is a gap in the evidence rather than a finding about the market.`,
    });
  }

  /* --------------------------------------------- review concentration */

  const reviewCounts = catchment.reviewedCompetitors.map((p) => p.reviewCount ?? 0);
  let concentrationPoints = 0;
  let concentration = 0;

  if (reviewCounts.length > 0) {
    concentration = round(normalisedConcentration(reviewCounts), 4);
    concentrationPoints = round(concentration * cfg.concentrationPoints, 2);
    const leader = catchment.reviewedCompetitors.reduce((best, p) =>
      (p.reviewCount ?? 0) > (best.reviewCount ?? 0) ? p : best,
    );
    const leaderShare = catchment.reviewTotal > 0 ? (leader.reviewCount ?? 0) / catchment.reviewTotal : 0;
    parts.push({
      id: "review-concentration",
      label: "Review-share concentration",
      points: concentrationPoints,
      available: cfg.concentrationPoints,
      detail:
        `${leader.name} holds ${formatNumber(leaderShare * 100, 0)}% of the catchment's reviews across ` +
        `${plural(reviewCounts.length, "reviewed facility", "reviewed facilities")}`,
    });
  } else {
    parts.push({
      id: "review-concentration",
      label: "Review-share concentration",
      points: 0,
      available: cfg.concentrationPoints,
      detail: "no reviewed facility in the catchment",
    });
  }

  /* --------------------------------------------------- unserved sports */

  const servedTermIds = new Set<string>();
  for (const place of catchment.competitors) {
    for (const termId of place.matchedTerms) servedTermIds.add(termId);
  }
  const unserved = input.scannedFormats.filter((f) => !servedTermIds.has(f.termId));
  const gate = clamp(demandFraction, 0, 1);
  const rawUnservedPoints = saturating(unserved.length, cfg.unservedSportsX0, cfg.unservedSportsPoints);
  const unservedPoints = round(rawUnservedPoints * gate, 2);

  parts.push({
    id: "unserved-sports",
    label: "Sports with demand and no supply",
    points: unservedPoints,
    available: cfg.unservedSportsPoints,
    detail:
      input.scannedFormats.length === 0
        ? "no playable sport format was included in this scan"
        : unserved.length === 0
          ? `all ${plural(input.scannedFormats.length, "scanned format has", "scanned formats have")} at least one facility in the catchment`
          : `${listOf(unserved.map((f) => f.label))} returned no facility; scaled by the catchment's measured demand (${formatNumber(gate * 100, 0)}% of the anchor component)`,
  });

  if (unserved.length > 0 && gate < 0.25) {
    flags.push({
      code: "service_gap_unserved_without_demand",
      severity: "info",
      component: "service-gap",
      message:
        `${plural(unserved.length, "scanned format has", "scanned formats have")} no facility in the ` +
        `catchment, but the measured demand-anchor base is weak, so this counts for little. An unserved ` +
        `format is only an opportunity where there is demand to serve.`,
    });
  }

  /* -------------------------------------------------- complaint themes */

  const negativeByTheme = new Map<string, Set<string>>();
  const analysedPlaces = new Set<string>();
  for (const theme of input.reviewThemes) {
    analysedPlaces.add(theme.placeId);
    if (theme.sentiment !== "negative" || theme.mentionCount <= 0) continue;
    const set = negativeByTheme.get(theme.theme) ?? new Set<string>();
    set.add(theme.placeId);
    negativeByTheme.set(theme.theme, set);
  }

  let complaintPoints = 0;
  let topComplaint: ServiceGapOutcome["topComplaint"] = null;
  const analysedCount = analysedPlaces.size;

  if (!input.themesExtracted) {
    parts.push({
      id: "complaint-themes",
      label: "Recurring complaint themes",
      points: 0,
      available: cfg.complaintThemePoints,
      detail: "review text has not been analysed for this scan yet",
    });
    flags.push({
      code: "service_gap_themes_not_extracted",
      severity: "info",
      component: "service-gap",
      message:
        `Review text has not yet been analysed, so ${formatNumber(cfg.complaintThemePoints, 0)} points of ` +
        `the service-gap component were not awarded. Re-scoring the scan once analysis has run can only ` +
        `raise the total.`,
    });
  } else if (analysedCount < cfg.minCompetitorsWithThemes) {
    parts.push({
      id: "complaint-themes",
      label: "Recurring complaint themes",
      points: 0,
      available: cfg.complaintThemePoints,
      detail: `only ${plural(analysedCount, "facility has", "facilities have")} review text to analyse`,
    });
    flags.push({
      code: "service_gap_themes_too_few",
      severity: "info",
      component: "service-gap",
      message:
        `Only ${plural(analysedCount, "facility in the catchment carries", "facilities in the catchment carry")} ` +
        `review text, which is too little to call a complaint recurring. A theme found at one venue is that ` +
        `venue's problem, not the market's.`,
    });
  } else {
    let bestTheme = "";
    let bestVenues = 0;
    for (const [theme, places] of [...negativeByTheme.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      if (places.size > bestVenues) {
        bestVenues = places.size;
        bestTheme = theme;
      }
    }
    const share = analysedCount > 0 ? bestVenues / analysedCount : 0;
    complaintPoints = round(
      clamp(share / cfg.complaintShareForFullPoints, 0, 1) * cfg.complaintThemePoints,
      2,
    );
    topComplaint = bestVenues > 0 ? { theme: bestTheme, venues: bestVenues, of: analysedCount } : null;
    parts.push({
      id: "complaint-themes",
      label: "Recurring complaint themes",
      points: complaintPoints,
      available: cfg.complaintThemePoints,
      detail: topComplaint
        ? `${bestVenues} of ${analysedCount} analysed facilities draw complaints about ${reviewThemeComplaintPhrase(bestTheme)}`
        : `no recurring complaint across the ${analysedCount} analysed facilities`,
    });
  }

  const points = round(ratingPoints + concentrationPoints + unservedPoints + complaintPoints, 2);

  return {
    component: {
      id: "service-gap",
      label: "Service gap",
      points,
      available,
      included: true,
      inputs: {
        ratedFacilityCount: ratedCount,
        avgRating: avgRating === null ? null : round(avgRating, 2),
        ratingBaseline: cfg.ratingBaseline,
        ratingGap: round(ratingGap, 2),
        reviewConcentration: concentration,
        scannedFormatCount: input.scannedFormats.length,
        unservedFormatCount: unserved.length,
        demandGate: round(gate, 3),
        analysedFacilityCount: analysedCount,
        topComplaintTheme: topComplaint?.theme ?? null,
        topComplaintVenues: topComplaint?.venues ?? 0,
      },
      justification: justify(points, available, parts, topComplaint, ratingGap, ratedCount, avgRating),
      parts,
      flags,
    },
    unservedFormats: unserved.map((f) => f.label),
    topComplaint,
  };
}

function justify(
  points: number,
  available: number,
  parts: readonly ComponentPart[],
  topComplaint: ServiceGapOutcome["topComplaint"],
  ratingGap: number,
  ratedCount: number,
  avgRating: number | null,
): string {
  const head = `${formatNumber(points, 1)}/${formatNumber(available, 0)} — `;

  const clauses: string[] = [];
  if (ratedCount > 0 && avgRating !== null) {
    clauses.push(
      `${plural(ratedCount, "rated facility averages", "rated facilities average")} ${formatNumber(avgRating, 1)}` +
        (ratingGap > 0 ? `, ${formatNumber(ratingGap, 1)} below what a well-run new site can reach` : `, leaving no rating gap to take`),
    );
  }
  const concentration = parts.find((p) => p.id === "review-concentration");
  if (concentration && concentration.points > 0) clauses.push(concentration.detail);
  const unservedPart = parts.find((p) => p.id === "unserved-sports");
  if (unservedPart && unservedPart.points > 0) clauses.push(unservedPart.detail);
  if (topComplaint) {
    clauses.push(
      `${topComplaint.venues} of ${topComplaint.of} analysed facilities draw complaints about ` +
        `${reviewThemeComplaintPhrase(topComplaint.theme)}`,
    );
  }

  if (clauses.length === 0) {
    return (
      head +
      "no measurable service gap was found: the catchment offers no rating, review or complaint evidence " +
      "of a weakness a new facility could take."
    );
  }
  return `${head}${listOf(clauses)}.`;
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join("; ")} and ${items[items.length - 1]}`;
}
