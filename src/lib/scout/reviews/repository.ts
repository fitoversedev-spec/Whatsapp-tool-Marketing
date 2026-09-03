import "server-only";

/**
 * Reading review text and reading/writing the theme cache.
 *
 * `place_reviews` is keyed by the **internal `places.id` uuid**, not by
 * Google's `place_id` string (`docs/PHASE-1-HANDOFF.md` §6), so everything
 * here carries both: the uuid to join on, and the Google id because that is
 * what `ScoreInput` keys themes by.
 */

import { Prisma, prisma, type Database, type DatabaseClient } from "@/lib/scout/db";
import { ANALYSED_MARKER_THEME, isReviewThemeId } from "@/lib/scout/scoring";
import type { ScoreReviewTheme, ThemeSentiment } from "@/lib/scout/scoring";

import { hashReviews, usableReviews } from "./prompt";
import type { PlaceReviewText, ThemeExtractionJob, ThemeExtractionResult } from "./types";

/**
 * One extraction job per competing venue in the scan that has review text.
 *
 * Competition only. Phase 1 fetches reviews at Atmosphere tier for competition
 * categories and at Pro tier for demand anchors, so a school never has review
 * text to analyse and asking for it would be a join that always returns
 * nothing.
 */
export async function getCompetitorReviewJobs(
  scanId: string,
  database: Database = prisma,
): Promise<ThemeExtractionJob[]> {
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT p.id::text          AS place_internal_id,
           p.place_id          AS google_place_id,
           p.name              AS name,
           r.google_review_id  AS google_review_id,
           r.rating            AS rating,
           r.text              AS text
    FROM scan_places sp
    JOIN places p ON p.id = sp.place_id
    LEFT JOIN place_reviews r ON r.place_id = p.id
    WHERE sp.scan_id = ${scanId}::uuid
      AND sp.side = 'competition'
    ORDER BY p.id ASC, r.google_review_id ASC NULLS LAST
  `);

  const byPlace = new Map<
    string,
    { googlePlaceId: string; name: string; reviews: PlaceReviewText[] }
  >();

  for (const row of rows) {
    const internalId = String(row.place_internal_id);
    const entry =
      byPlace.get(internalId) ??
      ({
        googlePlaceId: String(row.google_place_id),
        name: String(row.name),
        reviews: [] as PlaceReviewText[],
      } satisfies { googlePlaceId: string; name: string; reviews: PlaceReviewText[] });

    if (row.text !== null && row.text !== undefined) {
      entry.reviews.push({
        googleReviewId: row.google_review_id === null ? null : String(row.google_review_id),
        rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
        text: String(row.text),
      });
    }
    byPlace.set(internalId, entry);
  }

  const jobs: ThemeExtractionJob[] = [];
  for (const [placeInternalId, entry] of byPlace) {
    const reviews = usableReviews(entry.reviews);
    if (reviews.length === 0) continue;
    jobs.push({
      placeInternalId,
      googlePlaceId: entry.googlePlaceId,
      placeName: entry.name,
      reviews,
      reviewHash: hashReviews(reviews),
    });
  }
  // Stable order so a partial run always makes progress in the same sequence.
  return jobs.sort((a, b) => a.googlePlaceId.localeCompare(b.googlePlaceId));
}

export interface CachedThemeRow {
  readonly placeInternalId: string;
  readonly reviewHash: string;
  readonly theme: string;
  readonly sentiment: string | null;
  readonly mentionCount: number;
  readonly evidence: Array<Record<string, unknown>>;
}

/** Rows already computed for these `(place, hash)` pairs. */
export async function getCachedThemes(
  jobs: readonly ThemeExtractionJob[],
  database: Database = prisma,
): Promise<Map<string, CachedThemeRow[]>> {
  const out = new Map<string, CachedThemeRow[]>();
  if (jobs.length === 0) return out;

  const placeIds = jobs.map((j) => j.placeInternalId);
  const hashes = [...new Set(jobs.map((j) => j.reviewHash))];

  /**
   * `= ANY($1)` with a single array parameter.
   *
   * Under Drizzle this had to be an `IN (…)` list of individually bound
   * parameters, because drizzle's `sql` template bound a JS array as one scalar
   * value that Postgres then rejected as a malformed array literal. Prisma's pg
   * adapter binds a JS array as a real Postgres array, so the list can collapse
   * back to one parameter. Same rows, and no longer one bind per venue.
   */
  const rows = await database.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT place_id::text AS place_internal_id, review_hash, theme, sentiment,
           mention_count, evidence
    FROM review_themes
    WHERE place_id = ANY(${placeIds}::uuid[])
      AND review_hash = ANY(${hashes}::text[])
  `);

  for (const row of rows) {
    const key = `${String(row.place_internal_id)}:${String(row.review_hash)}`;
    const list = out.get(key) ?? [];
    list.push({
      placeInternalId: String(row.place_internal_id),
      reviewHash: String(row.review_hash),
      theme: String(row.theme),
      sentiment: row.sentiment === null ? null : String(row.sentiment),
      mentionCount: Number(row.mention_count ?? 0),
      evidence: (row.evidence as Array<Record<string, unknown>>) ?? [],
    });
    out.set(key, list);
  }
  return out;
}

/**
 * Persist one venue's themes, plus the marker row that records the analysis
 * happened at all.
 *
 * Delete-then-insert inside a transaction, keyed on `(place_id, review_hash)`:
 * a re-run must replace what it produced rather than accumulate a second copy,
 * and the unique index means a naive insert would fail rather than update.
 */
export async function saveThemes(
  result: ThemeExtractionResult,
  database: DatabaseClient = prisma,
): Promise<number> {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM review_themes
      WHERE place_id = ${result.placeInternalId}::uuid
        AND review_hash = ${result.reviewHash}
    `);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO review_themes (place_id, review_hash, theme, sentiment, mention_count, evidence, model_version)
      VALUES (${result.placeInternalId}::uuid, ${result.reviewHash}, ${ANALYSED_MARKER_THEME},
              'neutral', 0, '[]'::jsonb, ${result.modelVersion})
    `);

    for (const theme of result.themes) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO review_themes (place_id, review_hash, theme, sentiment, mention_count, evidence, model_version)
        VALUES (${result.placeInternalId}::uuid, ${result.reviewHash}, ${theme.theme},
                ${theme.sentiment}, ${theme.mentionCount},
                ${JSON.stringify(theme.quotes.map((q) => ({ quote: q })))}::jsonb,
                ${result.modelVersion})
      `);
    }
    return result.themes.length;
  });
}

export interface ScanThemeState {
  /** Themes as the scoring module consumes them, keyed by Google `place_id`. */
  readonly themes: ScoreReviewTheme[];
  /** Venues with review text worth analysing. */
  readonly candidates: number;
  /** Venues whose current reviews already have themes. */
  readonly analysed: number;
  /**
   * True when every candidate has been analysed, or when there was nothing to
   * analyse. Component 4 distinguishes this from "analysed, nothing found".
   */
  readonly themesExtracted: boolean;
  /** Verbatim evidence for the report, by Google `place_id` and theme. */
  readonly evidence: Array<{ googlePlaceId: string; theme: string; quote: string }>;
}

/** Everything the score needs to know about this scan's review themes. */
export async function loadScanThemeState(
  scanId: string,
  database: Database = prisma,
): Promise<ScanThemeState> {
  const jobs = await getCompetitorReviewJobs(scanId, database);
  const cached = await getCachedThemes(jobs, database);

  const themes: ScoreReviewTheme[] = [];
  const evidence: ScanThemeState["evidence"] = [];
  let analysed = 0;

  for (const job of jobs) {
    const rows = cached.get(`${job.placeInternalId}:${job.reviewHash}`);
    if (!rows || rows.length === 0) continue;
    analysed += 1;

    for (const row of rows) {
      if (row.theme === ANALYSED_MARKER_THEME) {
        // The marker itself: counts the venue as analysed, scores nothing.
        themes.push({
          placeId: job.googlePlaceId,
          theme: ANALYSED_MARKER_THEME,
          sentiment: "neutral",
          mentionCount: 0,
        });
        continue;
      }
      if (!isReviewThemeId(row.theme)) continue;
      themes.push({
        placeId: job.googlePlaceId,
        theme: row.theme,
        sentiment: (row.sentiment ?? "neutral") as ThemeSentiment,
        mentionCount: row.mentionCount,
      });
      for (const item of row.evidence) {
        if (typeof item.quote === "string") {
          evidence.push({ googlePlaceId: job.googlePlaceId, theme: row.theme, quote: item.quote });
        }
      }
    }
  }

  return {
    themes,
    candidates: jobs.length,
    analysed,
    themesExtracted: jobs.length === 0 || analysed >= jobs.length,
    evidence,
  };
}
