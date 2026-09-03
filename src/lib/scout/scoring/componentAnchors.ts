/**
 * Component 1 — **demand anchors**, 30 points.
 *
 * With population deferred this component carries the entire demand load, and
 * its output is also the denominator component 2 divides by. Get it wrong and
 * two of the five components are wrong together.
 *
 * Each demand-side place contributes `w × e^(−d/D)`, where `w` is its
 * type weight and `D` is `radius / 2`. A school across the road and a school
 * at the edge of a 3 km catchment are not the same anchor, and a model that
 * counts them alike would rate a plot by what is *near it* no more accurately
 * than by what is *in the same postcode*.
 *
 * The weighted total then runs through the saturating curve, so twenty schools
 * do not out-argue three tech parks and a metro station.
 */

import {
  distanceDecay,
  formatCount,
  formatDistance,
  formatNumber,
  formatWeight,
  plural,
  round,
  saturating,
} from "./curves";
import type { ScoreModel } from "./model";
import type { ComponentScore, ScoreFlag, ScoreInput, ScoreInputPlace } from "./types";

export interface AnchorContribution {
  /** Term or category the weight came from, for the explainability table. */
  readonly sourceId: string;
  readonly weight: number;
  readonly count: number;
  /** Sum of `w × decay` for the places at this weight. */
  readonly weighted: number;
}

export interface AnchorsOutcome {
  readonly component: ComponentScore;
  /** The figure component 2 divides by. Rounded to 2 dp, as printed. */
  readonly weightedTotal: number;
  readonly anchorCount: number;
  readonly contributions: readonly AnchorContribution[];
}

/**
 * The weight for one place: the highest weight any of its matched terms
 * carries, falling back to the highest of its categories, then to the model's
 * default.
 *
 * Highest rather than first, because `scan_places.categories` is a set with no
 * meaningful order — v16's bug was letting term order decide a place's
 * identity, and picking "whichever matched first" here would reintroduce it in
 * a quieter form.
 */
export function anchorWeightFor(
  place: ScoreInputPlace,
  model: ScoreModel,
): { weight: number; sourceId: string } {
  const { termWeights, categoryWeights, defaultWeight } = model.weights.anchors;

  let best = -1;
  let sourceId = "";
  for (const termId of place.matchedTerms) {
    const w = termWeights[termId];
    if (typeof w === "number" && w > best) {
      best = w;
      sourceId = termId;
    }
  }
  if (best >= 0) return { weight: best, sourceId };

  for (const categoryId of place.categories) {
    const w = categoryWeights[categoryId];
    if (typeof w === "number" && w > best) {
      best = w;
      sourceId = categoryId;
    }
  }
  if (best >= 0) return { weight: best, sourceId };

  return { weight: defaultWeight, sourceId: "unweighted" };
}

/** Human label for a weight source, for the justification and the report. */
function sourceLabel(sourceId: string): string {
  return SOURCE_LABELS[sourceId] ?? sourceId.replace(/-/g, " ");
}

const SOURCE_LABELS: Record<string, string> = {
  "tech-park": "tech parks",
  "office-complex": "office complexes",
  coworking: "coworking spaces",
  college: "colleges",
  university: "universities",
  "apartment-complex": "apartment complexes",
  "gated-community": "gated communities",
  school: "schools",
  "international-school": "international schools",
  "sports-academy": "sports academies",
  hostel: "hostels",
  "metro-station": "metro stations",
  "bus-terminal": "bus terminals",
  cafe: "cafés",
  restaurant: "restaurants",
  mall: "malls",
  hotel: "hotels",
  workplaces: "workplaces",
  residential: "apartment complexes and gated communities",
  education: "schools and colleges",
  transit: "transit points",
  lifestyle: "cafés, malls and restaurants",
  unweighted: "unweighted places",
};

export function scoreDemandAnchors(input: ScoreInput, model: ScoreModel): AnchorsOutcome {
  const available = model.weights.components.demandAnchors;
  const decayDistanceM = input.radiusM / model.weights.anchors.distanceDecayDivisor;

  const demand = input.places.filter((p) => p.side === "demand");

  const bySource = new Map<string, { weight: number; count: number; weighted: number }>();
  let weightedTotal = 0;

  for (const place of demand) {
    const { weight, sourceId } = anchorWeightFor(place, model);
    const contribution = weight * distanceDecay(place.distanceM, decayDistanceM);
    weightedTotal += contribution;

    const entry = bySource.get(sourceId) ?? { weight, count: 0, weighted: 0 };
    entry.count += 1;
    entry.weighted += contribution;
    bySource.set(sourceId, entry);
  }

  const contributions: AnchorContribution[] = [...bySource.entries()]
    .map(([sourceId, e]) => ({
      sourceId,
      weight: e.weight,
      count: e.count,
      weighted: round(e.weighted, 2),
    }))
    .sort((a, b) => b.weighted - a.weighted || a.sourceId.localeCompare(b.sourceId));

  const rawTotal = round(weightedTotal, 2);
  const points = round(saturating(rawTotal, model.weights.anchors.curveX0, available), 2);

  const flags: ScoreFlag[] = [];
  const unweighted = bySource.get("unweighted");
  if (unweighted && unweighted.count > 0) {
    flags.push({
      code: "anchors_unweighted_places",
      severity: "info",
      component: "demand-anchors",
      message:
        `${plural(unweighted.count, "demand-side place carries", "demand-side places carry")} no anchor ` +
        `weight in model ${model.version} and contributed nothing. They are listed in the places table.`,
    });
  }
  if (demand.length === 0) {
    flags.push({
      code: "anchors_none_found",
      severity: "warning",
      component: "demand-anchors",
      message:
        "No demand anchors were found in the catchment. Read this together with the competitive " +
        "saturation and market proof components before drawing any conclusion from either.",
    });
  }

  return {
    component: {
      id: "demand-anchors",
      label: "Demand anchors",
      points,
      available,
      included: true,
      inputs: {
        anchorCount: demand.length,
        weightedAnchorTotal: rawTotal,
        radiusM: input.radiusM,
        decayDistanceM: round(decayDistanceM, 0),
        curveX0: model.weights.anchors.curveX0,
      },
      justification: justify(input, demand, contributions, rawTotal, points, available),
      parts: contributions.slice(0, 6).map((c) => ({
        id: c.sourceId,
        label: sourceLabel(c.sourceId),
        points: c.weighted,
        available: null,
        detail: `${formatCount(c.count)} × weight ${formatWeight(c.weight)} → ${formatNumber(c.weighted, 2)} after distance decay`,
      })),
      flags,
    },
    weightedTotal: rawTotal,
    anchorCount: demand.length,
    contributions,
  };
}

function justify(
  input: ScoreInput,
  demand: readonly ScoreInputPlace[],
  contributions: readonly AnchorContribution[],
  weightedTotal: number,
  points: number,
  available: number,
): string {
  const head = `${formatNumber(points, 1)}/${formatNumber(available, 0)} — `;
  const radius = formatDistance(input.radiusM);

  if (demand.length === 0) {
    return (
      head +
      `no Google-listed demand anchors — schools, colleges, offices, apartment complexes, hostels ` +
      `or transit points — were found within ${radius} of the site.`
    );
  }

  const top = contributions
    .filter((c) => c.weight > 0)
    .slice(0, 3)
    .map((c) => `${formatCount(c.count)} ${sourceLabel(c.sourceId)} at ${formatWeight(c.weight)} each`);

  const qualifier = input.anySaturated ? "at least " : "";
  const lead =
    `${qualifier}${plural(demand.length, "Google-listed demand anchor", "Google-listed demand anchors")} ` +
    `within ${radius} weight to ${formatNumber(weightedTotal, 1)} after distance decay`;

  return top.length > 0
    ? `${head}${lead}; the largest contributions are ${listOf(top)}.`
    : `${head}${lead}.`;
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
