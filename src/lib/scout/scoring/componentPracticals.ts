/**
 * Component 5 — **site practicals**, 15 points, from the surveyor's checklist.
 *
 * Fourteen fields in four groups, each 0–3 (`checklist.ts`, the client's D6
 * answer). Split evenly each is worth about a point, which is wrong for at
 * least one of them — a site where **evening play is prohibited** loses the
 * entire 7–11 pm peak revenue window, which is nearer a deal-breaker than a
 * deduction.
 *
 * Two mechanisms answer that, and they are different things:
 *
 * - **Per-field weights**, in the score model. Even at 1.0 in v1.0.0 because
 *   the client was asked which fields are make-or-break and had not replied;
 *   changing them is a row edit and a version bump, not a deploy.
 * - **Hard flags**, also in the score model. A field at or below its threshold
 *   surfaces on the report *regardless of the total score*. This is the part a
 *   weight cannot do: the problem with a prohibited evening is not that the
 *   site scores a little lower, it is that the reader must see the restriction
 *   whatever the number says.
 *
 * ## Absence is not zero
 *
 * An unanswered field is absent from `surveyorInputs`, never `0` — zero is the
 * worst possible observation. Below `minAnsweredFields` the whole component is
 * **excluded** rather than scored, the total rescales over the remaining 85,
 * and the result carries `basis: 'desk_only'`. That is the correct treatment
 * of unknown, and it is also why the two bases are not comparable.
 */

import { CHECKLIST_MAX_RATING, SURVEYOR_CHECKLIST, getChecklistField } from "./checklist";
import { formatNumber, plural, round } from "./curves";
import type { ScoreModel } from "./model";
import type { ComponentScore, ScoreFlag, ScoreInput } from "./types";

export interface PracticalsOutcome {
  readonly component: ComponentScore;
  /** Fields answered, of the fields the model gives weight to. */
  readonly answeredCount: number;
  readonly weightedFieldCount: number;
}

export function scoreSitePracticals(input: ScoreInput, model: ScoreModel): PracticalsOutcome {
  const available = model.weights.components.sitePracticals;
  const cfg = model.weights.practicals;
  const flags: ScoreFlag[] = [];

  const surveyor = input.surveyor ?? {};
  const weightedFields = SURVEYOR_CHECKLIST.filter((f) => (cfg.fieldWeights[f.id] ?? 0) > 0);
  const answered = weightedFields.filter((f) => typeof surveyor[f.id] === "number");

  /* Hard flags fire on what was observed, whether or not the component scores. */
  for (const [fieldId, threshold] of Object.entries(cfg.hardFlagAtOrBelow)) {
    const rating = surveyor[fieldId];
    if (typeof rating !== "number" || rating > threshold) continue;
    const field = getChecklistField(fieldId);
    if (!field) continue;
    flags.push({
      code: `practicals_hard_flag:${fieldId}`,
      severity: "hard",
      component: "site-practicals",
      message:
        `${field.label}: "${field.anchors[rating] ?? String(rating)}". This is recorded as a hard flag in ` +
        `model ${model.version} and is reported regardless of the site's total score.`,
    });
  }

  if (answered.length < cfg.minAnsweredFields) {
    flags.push({
      code: "practicals_not_surveyed",
      severity: "warning",
      component: "site-practicals",
      message:
        answered.length === 0
          ? `No site survey has been recorded, so the ${formatNumber(available, 0)} site-practicals points ` +
            `were excluded and the remaining components were rescaled to 100. This score is a desk ` +
            `assessment and is not comparable with a surveyed site's score.`
          : `Only ${plural(answered.length, "checklist field was", "checklist fields were")} recorded, below the ` +
            `${cfg.minAnsweredFields} the model requires to treat this as a site survey. The component was ` +
            `excluded and the remaining components rescaled to 100.`,
    });
    return {
      component: {
        id: "site-practicals",
        label: "Site practicals",
        points: 0,
        available,
        included: false,
        inputs: {
          answeredFieldCount: answered.length,
          checklistFieldCount: weightedFields.length,
          minAnsweredFields: cfg.minAnsweredFields,
        },
        justification:
          `Not scored — ${answered.length === 0 ? "no site survey has been recorded" : `only ${plural(answered.length, "of the checklist field was", "of the checklist fields were")} recorded`}. ` +
          `The ${formatNumber(available, 0)} points were excluded rather than scored as zero, because an ` +
          `unvisited site is unknown, not bad. The total is rescaled over the remaining ` +
          `${formatNumber(100 - available, 0)} points and labelled a desk assessment.`,
        parts: [],
        flags,
      },
      answeredCount: answered.length,
      weightedFieldCount: weightedFields.length,
    };
  }

  let weightSum = 0;
  let weightedRating = 0;
  for (const field of answered) {
    const weight = cfg.fieldWeights[field.id] ?? 0;
    weightSum += weight;
    weightedRating += weight * (surveyor[field.id] ?? 0);
  }

  const meanRating = weightSum > 0 ? weightedRating / (weightSum * CHECKLIST_MAX_RATING) : 0;
  const points = round(meanRating * available, 2);

  if (answered.length < weightedFields.length) {
    const missing = weightedFields.filter((f) => typeof surveyor[f.id] !== "number");
    flags.push({
      code: "practicals_partial_survey",
      severity: "warning",
      component: "site-practicals",
      message:
        `${answered.length} of ${weightedFields.length} checklist fields were recorded. The unanswered ` +
        `fields — ${missing.map((f) => f.label.toLowerCase()).join(", ")} — were left out of the average ` +
        `rather than counted as zero, so this component rests on a partial survey.`,
    });
  }

  const weakest = [...answered]
    .sort((a, b) => (surveyor[a.id] ?? 0) - (surveyor[b.id] ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 3)
    .filter((f) => (surveyor[f.id] ?? 0) < CHECKLIST_MAX_RATING);

  return {
    component: {
      id: "site-practicals",
      label: "Site practicals",
      points,
      available,
      included: true,
      inputs: {
        answeredFieldCount: answered.length,
        checklistFieldCount: weightedFields.length,
        weightedMeanRating: round(meanRating * CHECKLIST_MAX_RATING, 2),
        maxRating: CHECKLIST_MAX_RATING,
      },
      justification:
        `${formatNumber(points, 1)}/${formatNumber(available, 0)} — ` +
        `${answered.length} of ${weightedFields.length} checklist fields recorded, averaging ` +
        `${formatNumber(meanRating * CHECKLIST_MAX_RATING, 1)} of ${CHECKLIST_MAX_RATING}` +
        (weakest.length > 0
          ? `; the weakest are ${weakest.map((f) => `${f.label.toLowerCase()} (${surveyor[f.id]}/${CHECKLIST_MAX_RATING})`).join(", ")}.`
          : `, with no field below ${CHECKLIST_MAX_RATING}.`),
      parts: answered.map((f) => ({
        id: f.id,
        label: f.label,
        points: round(
          ((cfg.fieldWeights[f.id] ?? 0) * (surveyor[f.id] ?? 0)) /
            (weightSum * CHECKLIST_MAX_RATING) *
            available,
          2,
        ),
        available: round(((cfg.fieldWeights[f.id] ?? 0) / weightSum) * available, 2),
        detail: f.anchors[surveyor[f.id] ?? 0] ?? String(surveyor[f.id]),
      })),
      flags,
    },
    answeredCount: answered.length,
    weightedFieldCount: weightedFields.length,
  };
}
