import "server-only";

/**
 * Scoring a scan, and writing the result down.
 *
 * ## What is persisted, and why each piece
 *
 * | Column | Why it is not derivable later |
 * |---|---|
 * | `scans.score_model_version` | The model row may be superseded; the number must still reproduce |
 * | `scans.score_basis` | The dashboard sorts by score, and `desk_only` must never be silently ranked against `full` |
 * | `scans.score_confidence` | A 78 at low confidence is a different recommendation from a 78 at high |
 * | `scans.score_breakdown` | The score never appears without its breakdown, anywhere |
 * | `scan_places.anchor_weight` | `city_benchmarks` has no denominator until this is filled — Phase 2 skips every scan without it |
 *
 * That last row is the one with a dependency attached: until Phase 3 writes
 * `anchor_weight`, `recomputeCityBenchmarks` counts every scan as
 * `skippedNoAnchorWeight` and the benchmark table stays empty — which is why
 * scoring writes it in the same transaction as the score.
 */

import { Prisma, prisma, type Database, type DatabaseClient } from "@/lib/scout/db";
import { POPULATION_LIMITATION_TEXT, SATURATION_METHOD_NOTE } from "@/lib/scout/census/disclosure";
import { anchorWeightFor, computeScore, distanceDecay } from "@/lib/scout/scoring";
import type { ScoreModel, ScoreResult } from "@/lib/scout/scoring";

import { buildScoreInput, type ScoreInputBundle } from "./buildInput";
import { getActiveScoreModel, getScoreModelByVersion } from "./modelRepository";

export interface ScoredScan {
  readonly scanId: string;
  readonly score: ScoreResult;
  readonly modelId: string;
  /** Verbatim review quotes backing the complaint themes, for the report. */
  readonly evidence: ScoreInputBundle["evidence"];
  /**
   * Text the report and every score surface must carry alongside a saturation
   * figure. Deliberately supplied here rather than inside `ScoreResult`: the
   * scoring module emits no sentence containing the word "population" at all,
   * which is what lets its own test assert their absence absolutely.
   */
  readonly disclosures: {
    readonly populationLimitation: string;
    readonly saturationMethodNote: string;
  };
}

export interface ScoreScanOptions {
  /** `persistScore` opens a transaction, so this has to be a full client. */
  readonly database?: DatabaseClient;
  /**
   * Reproduce an existing score under the version it was originally computed
   * with, instead of scoring afresh under the active model.
   */
  readonly modelVersion?: string;
  /** Skip the database write. Used by preview and by the comparison screen. */
  readonly persist?: boolean;
}

/**
 * Compute — and by default store — the score for a scan.
 *
 * Never calls the Claude API. Theme extraction is a separate, slower path
 * (`extractThemesForScan`); this reads whatever themes are already cached and
 * component 4 reports the difference between "not analysed" and "analysed,
 * nothing found". Scoring must not wait on a network call the score can do
 * without.
 */
export async function scoreScan(
  scanId: string,
  options: ScoreScanOptions = {},
): Promise<ScoredScan> {
  const database = options.database ?? prisma;
  const persist = options.persist ?? true;

  const [bundle, loaded] = await Promise.all([
    buildScoreInput(scanId, database),
    options.modelVersion
      ? getScoreModelByVersion(options.modelVersion, database)
      : getActiveScoreModel(database),
  ]);

  const score = computeScore(bundle.input, loaded.model);

  if (persist) {
    await persistScore(scanId, score, loaded.id, bundle, loaded.model, database);
  }

  return {
    scanId,
    score,
    modelId: loaded.id,
    evidence: bundle.evidence,
    disclosures: {
      populationLimitation: POPULATION_LIMITATION_TEXT,
      saturationMethodNote: SATURATION_METHOD_NOTE,
    },
  };
}

async function persistScore(
  scanId: string,
  score: ScoreResult,
  modelId: string,
  bundle: ScoreInputBundle,
  model: ScoreModel,
  database: DatabaseClient,
): Promise<void> {
  const decayDistanceM = bundle.input.radiusM / model.weights.anchors.distanceDecayDivisor;

  await database.$transaction(async (tx) => {
    /**
     * Raw only so `scored_at` and `updated_at` keep taking the database's
     * `now()` — the transaction timestamp — rather than this process's clock.
     * `score_total` is still `toFixed(2)`, so the stored number is byte-for-byte
     * what Drizzle wrote; it is a `Decimal` on the way back out instead of a
     * string.
     */
    await tx.$executeRaw(Prisma.sql`
      UPDATE scans SET
        score_model_id = ${modelId}::uuid,
        score_model_version = ${score.modelVersion},
        score_total = ${score.total.toFixed(2)}::numeric,
        score_verdict = ${score.verdict},
        score_basis = ${score.basis},
        score_confidence = ${score.confidence.level},
        score_breakdown = ${JSON.stringify(score)}::jsonb,
        scored_at = now(),
        updated_at = now()
      WHERE id = ${scanId}::uuid
    `);

    /**
     * Write each demand anchor's decayed weight back onto its membership row.
     *
     * One statement per distinct weight rather than one per place: a 2 km
     * scan has dozens of anchors and a handful of weights, and the benchmark
     * recompute only needs the sum.
     */
    const byWeight = new Map<number, string[]>();
    for (const place of bundle.input.places) {
      if (place.side !== "demand") continue;
      const { weight } = anchorWeightFor(place, model);
      const decayed = Number(
        (weight * distanceDecay(place.distanceM, decayDistanceM)).toFixed(6),
      );
      const list = byWeight.get(decayed) ?? [];
      list.push(place.placeId);
      byWeight.set(decayed, list);
    }

    for (const [weight, googlePlaceIds] of byWeight) {
      // One array parameter. Under Drizzle this had to be an `IN (…)` list of
      // individually bound parameters, because its `sql` template bound a JS
      // array as one scalar Postgres then rejected; Prisma's pg adapter binds a
      // real array, so `= ANY(…)` works.
      await tx.$executeRaw(Prisma.sql`
        UPDATE scan_places sp
        SET anchor_weight = ${weight}::real
        FROM places p
        WHERE p.id = sp.place_id
          AND sp.scan_id = ${scanId}::uuid
          AND p.place_id = ANY(${googlePlaceIds}::text[])
      `);
    }

    // Competition-side rows carry no anchor weight; make that explicit rather
    // than leaving a stale value from an earlier model behind.
    await tx.scanPlace.updateMany({
      where: { scanId, side: "competition" },
      data: { anchorWeight: null },
    });
  });
}

/**
 * Re-read a stored score without recomputing it.
 *
 * The dashboard and the comparison screen use this: a stored score is the one
 * the customer was shown, and silently re-scoring it under a newer model would
 * change a number somebody has already been told.
 */
export async function getStoredScore(
  scanId: string,
  database: Database = prisma,
): Promise<{ score: ScoreResult; modelVersion: string; scoredAt: Date | null } | null> {
  const row = await database.scan.findUnique({
    where: { id: scanId },
    select: { scoreBreakdown: true, scoreModelVersion: true, scoredAt: true },
  });

  if (!row || !row.scoreBreakdown) return null;
  return {
    score: row.scoreBreakdown as unknown as ScoreResult,
    modelVersion: row.scoreModelVersion ?? "unknown",
    scoredAt: row.scoredAt,
  };
}
