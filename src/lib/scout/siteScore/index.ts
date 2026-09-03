import "server-only";

/**
 * Server-side scoring: loading the model, assembling the input, computing and
 * persisting the result.
 *
 * The engine itself is in `src/lib/scoring/` and is pure. This is the half
 * that touches the database, and it is deliberately thin — the more that lives
 * here, the less of the score is reproducible from its inputs alone.
 */

export { buildScoreInput, scannedFormatsFor, ScanNotFoundError } from "./buildInput";
export type { ScoreInputBundle } from "./buildInput";

export {
  getActiveScoreModel,
  getScoreModelByVersion,
  listScoreModels,
  NoActiveScoreModelError,
  ScoreModelVersionNotFoundError,
} from "./modelRepository";
export type { LoadedScoreModel } from "./modelRepository";

export { getStoredScore, scoreScan } from "./scoreScan";
export type { ScoredScan, ScoreScanOptions } from "./scoreScan";
