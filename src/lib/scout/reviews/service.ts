import "server-only";

/**
 * Running theme extraction for a scan.
 *
 * Three properties this has to have, in priority order:
 *
 * 1. **It never blocks a score.** Extraction is the slow, paid part; the score
 *    is computed from whatever themes are cached and improves when more are.
 *    `POST /api/scout/scans/{id}/score` therefore scores first and kicks extraction
 *    off afterwards.
 * 2. **It never re-analyses unchanged reviews.** The cache key is
 *    `(place_id, review_hash)`, so a second scan of the same area — the
 *    realistic repeat case — pays nothing for venues it has already read.
 * 3. **It degrades rather than fails.** No API key, a rate limit, a refusal or
 *    a malformed response all mean "this venue has no themes", which component
 *    4 already reports as unmeasured. A scan is never lost to the classifier.
 */

import { prisma, type DatabaseClient } from "@/lib/scout/db";

import { createAnthropicExtractor } from "./extractor";
import { getCachedThemes, getCompetitorReviewJobs, saveThemes } from "./repository";
import type { ExtractionSummary, ThemeExtractor } from "./types";

/** Venues analysed at once. Small: this is a paid API and a background job. */
const DEFAULT_CONCURRENCY = 3;

export interface ExtractThemesOptions {
  readonly extractor?: ThemeExtractor;
  /** `saveThemes` opens a transaction, so this has to be a full client. */
  readonly database?: DatabaseClient;
  readonly concurrency?: number;
  /** Re-analyse even when the cache has a matching hash. Repair path only. */
  readonly force?: boolean;
}

/** Whether a key is configured. Absence means "skip", never "fail". */
export function themeExtractionAvailable(): boolean {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return Boolean(key) && key !== "PASTE_HERE";
}

export async function extractThemesForScan(
  scanId: string,
  options: ExtractThemesOptions = {},
): Promise<ExtractionSummary> {
  const database = options.database ?? prisma;
  const empty: ExtractionSummary = {
    scanId,
    candidates: 0,
    cacheHits: 0,
    analysed: 0,
    failed: 0,
    themesWritten: 0,
    rejectedThemes: 0,
    modelVersion: null,
    enabled: true,
  };

  if (!options.extractor && !themeExtractionAvailable()) {
    return { ...empty, enabled: false };
  }

  const jobs = await getCompetitorReviewJobs(scanId, database);
  if (jobs.length === 0) return { ...empty, candidates: 0 };

  const cached = options.force ? new Map() : await getCachedThemes(jobs, database);
  const pending = jobs.filter(
    (j) => (cached.get(`${j.placeInternalId}:${j.reviewHash}`) ?? []).length === 0,
  );
  const cacheHits = jobs.length - pending.length;

  const extractor = options.extractor ?? createAnthropicExtractor();
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  let analysed = 0;
  let failed = 0;
  let themesWritten = 0;
  let rejectedThemes = 0;

  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((job) => extractor.extract(job)));

    for (const [index, settled] of results.entries()) {
      if (settled.status === "rejected") {
        failed += 1;
        console.warn(
          JSON.stringify({
            event: "review_theme_extraction_failed",
            scanId,
            placeId: batch[index]?.googlePlaceId,
            // The message only — an API error can carry request detail.
            error: settled.reason instanceof Error ? settled.reason.message : "unknown",
          }),
        );
        continue;
      }
      analysed += 1;
      rejectedThemes += settled.value.rejectedThemes;
      themesWritten += await saveThemes(settled.value, database);
    }
  }

  return {
    scanId,
    candidates: jobs.length,
    cacheHits,
    analysed,
    failed,
    themesWritten,
    rejectedThemes,
    modelVersion: extractor.modelVersion,
    enabled: true,
  };
}
