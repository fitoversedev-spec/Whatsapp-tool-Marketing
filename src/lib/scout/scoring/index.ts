/**
 * The scoring engine — **pure**.
 *
 * No `server-only`, no `@/db`, no `pg`, no `next/*`, no `fetch`. Everything in
 * `src/lib/scoring/**` is a function from data to data, which is what makes a
 * score reproducible from its inputs and its model version alone.
 * `purity.test.ts` walks this directory and fails on any forbidden import, so
 * the guarantee survives the next person in a hurry.
 *
 * Server-side work — loading the model, assembling the input from a scan,
 * persisting the result — lives in `src/lib/siteScore/`. Review-theme
 * extraction lives in `src/lib/reviews/`. Both import from here; neither is
 * imported by anything here.
 */

export { computeScore, UnsupportedScoreModelError } from "./computeScore";

export {
  CHECKLIST_FIELD_IDS,
  CHECKLIST_GROUPS,
  CHECKLIST_MAX_RATING,
  CHECKLIST_VERSION,
  SURVEYOR_CHECKLIST,
  checklistFieldsInGroup,
  getChecklistField,
  sanitiseSurveyorInputs,
} from "./checklist";
export type {
  ChecklistFieldDef,
  ChecklistGroupDef,
  ChecklistGroupId,
  SurveyorInputs,
} from "./checklist";

export {
  InvalidScoreModelError,
  parseScoreModel,
  scoreModelSchema,
  scoreModelWeightsSchema,
} from "./model";
export type { ScoreModel, ScoreModelWeights } from "./model";

export { SCORE_MODEL_V1 } from "./modelV1";

export {
  ANALYSED_MARKER_THEME,
  REVIEW_THEMES,
  REVIEW_THEME_IDS,
  getReviewTheme,
  isReviewThemeId,
  reviewThemeComplaintPhrase,
  reviewThemeLabel,
} from "./themes";
export type { ReviewThemeDef, ReviewThemeId } from "./themes";

export { DESK_ONLY_LABEL, verdictFor, verdictStatement } from "./verdict";

export { anchorWeightFor } from "./componentAnchors";
/**
 * Exported so the persistence layer can write `scan_places.anchor_weight`
 * using exactly the decay the score used — a second implementation would
 * eventually disagree with the first, and `city_benchmarks` would be built on
 * the copy.
 */
export { distanceDecay, saturating } from "./curves";
export { deriveCatchment, isOperational } from "./catchment";

export type {
  ComponentId,
  ComponentPart,
  ComponentScore,
  ConfidenceLevel,
  ConfidenceResult,
  FlagSeverity,
  ScannedFormat,
  ScoreBasis,
  ScoreBenchmark,
  ScoreFlag,
  ScoreInput,
  ScoreInputPlace,
  ScoreResult,
  ScoreReviewTheme,
  ThemeSentiment,
  Verdict,
} from "./types";
