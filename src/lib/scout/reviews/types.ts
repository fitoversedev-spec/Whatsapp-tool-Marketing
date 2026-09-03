/**
 * Types for review-theme extraction.
 *
 * Kept separate from the client so the pieces that need no network — hashing,
 * prompt construction, quote verification — can be imported and tested without
 * an API key. Phase 1 built the whole Google client that way and it is why the
 * pipeline was testable before billing was approved.
 */

import type { ReviewThemeId, ThemeSentiment } from "@/lib/scout/scoring";

/** One review as stored by Phase 1 in `place_reviews`. */
export interface PlaceReviewText {
  /** Google's review resource name. Null-safe: a review without one is dropped at ingest. */
  readonly googleReviewId: string | null;
  readonly rating: number | null;
  readonly text: string | null;
}

/** One venue's reviews, ready to analyse. */
export interface ThemeExtractionJob {
  /** Internal `places.id` uuid — the key `place_reviews` joins on. */
  readonly placeInternalId: string;
  /** Google `place_id`, which is what `ScoreInput` keys themes by. */
  readonly googlePlaceId: string;
  readonly placeName: string;
  readonly reviews: readonly PlaceReviewText[];
  /** SHA-256 of `reviews`. The cache key. */
  readonly reviewHash: string;
}

/** A theme the model returned, after validation and quote verification. */
export interface ExtractedTheme {
  readonly theme: ReviewThemeId;
  readonly sentiment: ThemeSentiment;
  readonly mentionCount: number;
  /** Verbatim spans, each verified to appear in the reviews. Never empty. */
  readonly quotes: readonly string[];
}

export interface ThemeExtractionResult {
  readonly placeInternalId: string;
  readonly googlePlaceId: string;
  readonly reviewHash: string;
  readonly themes: readonly ExtractedTheme[];
  /** Model id that produced this, stored on the row for reproducibility. */
  readonly modelVersion: string;
  /** Themes dropped because no quote could be verified. Logged, never scored. */
  readonly rejectedThemes: number;
}

/**
 * The extraction port.
 *
 * An interface rather than a concrete client so the service, the cache and the
 * scoring path are all testable without a key or a network — the same shape
 * Phase 1's injectable `fetch` gave the Google client.
 */
export interface ThemeExtractor {
  readonly modelVersion: string;
  extract(job: ThemeExtractionJob): Promise<ThemeExtractionResult>;
}

export interface ExtractionSummary {
  readonly scanId: string;
  /** Venues that had reviews worth analysing. */
  readonly candidates: number;
  /** Venues served from the cache — no API call, no spend. */
  readonly cacheHits: number;
  /** Venues analysed on this run. */
  readonly analysed: number;
  /** Venues whose analysis failed; the score degrades rather than erroring. */
  readonly failed: number;
  readonly themesWritten: number;
  readonly rejectedThemes: number;
  readonly modelVersion: string | null;
  /** False when no API key is configured — extraction is skipped, not failed. */
  readonly enabled: boolean;
}
