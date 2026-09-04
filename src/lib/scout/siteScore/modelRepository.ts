import "server-only";

/**
 * Loading a score model from the database.
 *
 * **Weights are never hardcoded.** `computeScore` takes the model as a
 * required argument and this is the only thing that supplies one at runtime,
 * so tuning the score is a row change and a version bump rather than a deploy.
 *
 * Two ways in, and the difference matters:
 *
 * - `getActiveScoreModel()` — what a *new* score is computed with.
 * - `getScoreModelByVersion(v)` — what an *existing* score is reproduced with.
 *   A report regenerated a year later must reproduce its original number, so
 *   regeneration reads the version stamped on the scan, not whatever is active
 *   today.
 */

import { Prisma, prisma, type Database } from "@/lib/scout/db";
import { parseScoreModel, type ScoreModel } from "@/lib/scout/scoring";

export class NoActiveScoreModelError extends Error {
  constructor() {
    super(
      "No active score model exists. Run `pnpm db:seed` to publish v1.0.0, or activate a row in " +
        "`score_models`. Scores are never computed from compiled-in weights.",
    );
    this.name = "NoActiveScoreModelError";
  }
}

export class ScoreModelVersionNotFoundError extends Error {
  constructor(version: string) {
    super(
      `Score model ${version} is not in the database. A scan stamped with it cannot be reproduced ` +
        `until the row is restored — do not re-score it under a different version.`,
    );
    this.name = "ScoreModelVersionNotFoundError";
  }
}

interface ScoreModelRow {
  id: string;
  version: string;
  name: string;
  description: string | null;
  weights: unknown;
  includes_population: boolean;
}

function toModel(row: ScoreModelRow): ScoreModel {
  return parseScoreModel({
    version: row.version,
    name: row.name,
    description: row.description ?? "",
    includesPopulation: row.includes_population,
    weights: row.weights,
  });
}

export interface LoadedScoreModel {
  /** `score_models.id`, for the FK on `scans`. */
  readonly id: string;
  readonly model: ScoreModel;
}

export async function getActiveScoreModel(database: Database = prisma): Promise<LoadedScoreModel> {
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT id::text AS id, version, name, description, weights, includes_population
    FROM score_models
    WHERE is_active = TRUE
    LIMIT 1
  `);
  const row = rows[0] as unknown as ScoreModelRow & { id: string };
  if (!row) throw new NoActiveScoreModelError();
  return { id: row.id, model: toModel(row) };
}

export async function getScoreModelByVersion(
  version: string,
  database: Database = prisma,
): Promise<LoadedScoreModel> {
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT id::text AS id, version, name, description, weights, includes_population
    FROM score_models
    WHERE version = ${version}
    LIMIT 1
  `);
  const row = rows[0] as unknown as ScoreModelRow & { id: string };
  if (!row) throw new ScoreModelVersionNotFoundError(version);
  return { id: row.id, model: toModel(row) };
}

/** Every published model, newest version first. Phase 7's tuning screen. */
export async function listScoreModels(
  database: Database = prisma,
): Promise<Array<{ id: string; version: string; name: string; isActive: boolean; createdAt: Date }>> {
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT id::text AS id, version, name, is_active, created_at
    FROM score_models
    ORDER BY created_at DESC
  `);
  return rows.map((r) => ({
    id: String(r.id),
    version: String(r.version),
    name: String(r.name),
    isActive: Boolean(r.is_active),
    createdAt: new Date(r.created_at as string),
  }));
}

/**
 * Insert a new score model version and activate it in one transaction.
 *
 * The previous active model is deactivated so exactly one row has
 * `is_active = TRUE` at any time. The new model is validated through
 * `parseScoreModel` before insertion — if the weights do not total 100 or
 * any cross-field rule is violated the call throws and no row is written.
 */
export async function createScoreModel(
  model: ScoreModel,
  database: Database = prisma,
): Promise<{ id: string }> {
  // Validate before touching the database.
  parseScoreModel(model);

  const weightsJson = JSON.stringify(model.weights);

  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    WITH deactivate AS (
      UPDATE score_models SET is_active = FALSE WHERE is_active = TRUE
    )
    INSERT INTO score_models (version, name, description, weights, is_active, includes_population)
    VALUES (
      ${model.version},
      ${model.name},
      ${model.description || ""},
      ${weightsJson}::jsonb,
      TRUE,
      ${model.includesPopulation}
    )
    RETURNING id::text AS id
  `);
  const row = rows[0];
  if (!row) throw new Error("Insert returned no rows.");
  return { id: String(row.id) };
}

/**
 * Activate a specific model version, deactivating all others.
 */
export async function activateScoreModel(
  id: string,
  database: Database = prisma,
): Promise<void> {
  await database.$queryRaw(Prisma.sql`
    UPDATE score_models SET is_active = FALSE WHERE is_active = TRUE
  `);
  await database.$queryRaw(Prisma.sql`
    UPDATE score_models SET is_active = TRUE WHERE id = ${id}::uuid
  `);
}
