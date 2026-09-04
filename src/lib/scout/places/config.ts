/**
 * Every tuning knob the ingestion pipeline has, read from the environment once
 * and defaulted conservatively.
 *
 * Two of these groups exist specifically because we are shipping ahead of an
 * answer:
 *
 * - **Cache TTLs.** Google's caching terms are still under the client's legal
 *   review (requirement F1). The defaults below are short. When the answer
 *   arrives, changing retention is an environment variable, not a rewrite.
 *
 * - **Search limits.** The result caps and pagination behaviour are read from
 *   the live documentation but not yet exercised against a real key. Each one
 *   is a single named constant, listed in `docs/PHASE-1-UNVERIFIED.md` with
 *   the test to run once a key exists.
 *
 * Reading `process.env` lazily (getters, not module-level constants) matters:
 * Next evaluates modules at build time, and a build must not depend on runtime
 * secrets being present.
 */

import { DEFAULT_TILE_OVERLAP } from "@/lib/scout/geo/tiling";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(name: string, fallback: number): number {
  return Math.trunc(num(name, fallback));
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

/* --------------------------------------------------------- search limits */

/**
 * ⚠️ **V1.** Nearby Search (New) documents `maxResultCount` as 1–20 with no
 * pagination. If a tile hits this number the tile is flagged saturated.
 * See docs/PHASE-1-UNVERIFIED.md → V1.
 */
export const NEARBY_MAX_RESULTS = 20;

/**
 * ⚠️ **V1.** Text Search (New) documents `pageSize` 1–20 and pagination via
 * `pageToken` to a hard ceiling of 60 results. Three pages is therefore the
 * whole of what Google will give.
 */
export const TEXT_PAGE_SIZE = 20;
export const TEXT_MAX_RESULTS = 60;
export const TEXT_MAX_PAGES = Math.ceil(TEXT_MAX_RESULTS / TEXT_PAGE_SIZE);

/**
 * ⚠️ **V2.** `searchNearby` takes a circular `locationRestriction`;
 * `searchText` takes only a rectangular one, and only — per the docs — for
 * categorical queries. The client tries the rectangle first and falls back to
 * a circular `locationBias` if Google rejects it, so an incorrect reading here
 * degrades result precision rather than breaking the scan.
 */
export const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1";
export const GOOGLE_GEOCODE_BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/* -------------------------------------------------------------- defaults */

/** Fallbacks, exported so tests and the handoff quote the same numbers. */
export const PLACES_DEFAULTS = {
  tileRadiusM: 1200,
  tileOverlap: 0.2,
  maxTilesPerScan: 400,
  requestTimeoutMs: 12_000,
  maxRetries: 3,
  retryBaseDelayMs: 400,
  circuitFailureThreshold: 8,
  circuitResetMs: 30_000,
  concurrency: 4,
  /** Wall-clock budget for one worker invocation. Well under Vercel's 300 s. */
  workerBudgetMs: 45_000,
  /** A claimed job whose lease has expired is fair game for another worker. */
  jobLeaseMs: 90_000,
  /** Attempts per task before the task is marked failed and the scan continues. */
  taskMaxAttempts: 3,
  /** Conservative pending Google's caching terms (requirement F1). */
  placeTtlHours: 168,
  reviewTtlHours: 72,
  /** Per-user, per-day billable call ceiling. Generous by default. */
  dailyCallCap: 20_000,
  regionCode: "in",
  languageCode: "en",
} as const;

export const placesConfig = {
  /* ---- tiling ---- */
  get tileRadiusM(): number {
    return int("PLACES_TILE_RADIUS_M", PLACES_DEFAULTS.tileRadiusM);
  },
  get tileOverlap(): number {
    return num("PLACES_TILE_OVERLAP", PLACES_DEFAULTS.tileOverlap);
  },
  get maxTilesPerScan(): number {
    return int("PLACES_MAX_TILES", PLACES_DEFAULTS.maxTilesPerScan);
  },

  /* ---- HTTP behaviour ---- */
  get requestTimeoutMs(): number {
    return int("PLACES_REQUEST_TIMEOUT_MS", PLACES_DEFAULTS.requestTimeoutMs);
  },
  get maxRetries(): number {
    return int("PLACES_MAX_RETRIES", PLACES_DEFAULTS.maxRetries);
  },
  get retryBaseDelayMs(): number {
    return int("PLACES_RETRY_BASE_DELAY_MS", PLACES_DEFAULTS.retryBaseDelayMs);
  },
  get circuitFailureThreshold(): number {
    return int("PLACES_CIRCUIT_FAILURE_THRESHOLD", PLACES_DEFAULTS.circuitFailureThreshold);
  },
  get circuitResetMs(): number {
    return int("PLACES_CIRCUIT_RESET_MS", PLACES_DEFAULTS.circuitResetMs);
  },
  get concurrency(): number {
    return Math.max(1, int("PLACES_CONCURRENCY", PLACES_DEFAULTS.concurrency));
  },
  /**
   * Prefer a rectangular `locationRestriction` on Text Search over a circular
   * `locationBias`. Restriction is a hard boundary and therefore wastes fewer
   * results; bias is the documented-safe fallback. See V2.
   */
  get textUseLocationRestriction(): boolean {
    return bool("PLACES_TEXT_LOCATION_RESTRICTION", true);
  },

  /* ---- worker ---- */
  get workerBudgetMs(): number {
    return int("SCAN_WORKER_BUDGET_MS", PLACES_DEFAULTS.workerBudgetMs);
  },
  get jobLeaseMs(): number {
    return int("SCAN_JOB_LEASE_MS", PLACES_DEFAULTS.jobLeaseMs);
  },
  get taskMaxAttempts(): number {
    return Math.max(1, int("SCAN_TASK_MAX_ATTEMPTS", PLACES_DEFAULTS.taskMaxAttempts));
  },

  /* ---- cache, pending requirement F1 ---- */
  get placeTtlHours(): number {
    return num("PLACES_CACHE_TTL_HOURS", PLACES_DEFAULTS.placeTtlHours);
  },
  get reviewTtlHours(): number {
    return num("PLACES_REVIEW_CACHE_TTL_HOURS", PLACES_DEFAULTS.reviewTtlHours);
  },

  /* ---- cost ---- */
  get dailyCallCap(): number {
    return int("PLACES_DAILY_CALL_CAP", PLACES_DEFAULTS.dailyCallCap);
  },

  /* ---- locale ---- */
  get regionCode(): string {
    return process.env.PLACES_REGION_CODE?.trim() || PLACES_DEFAULTS.regionCode;
  },
  get languageCode(): string {
    return process.env.PLACES_LANGUAGE_CODE?.trim() || PLACES_DEFAULTS.languageCode;
  },
} as const;

/**
 * Published list prices per 1 000 calls, USD, read from Google's pricing page
 * on 18 Aug 2026.
 *
 * ⚠️ **V4.** These drive the *estimate* only. Real cost per scan cannot be
 * measured until a key exists, and India-specific pricing and volume tiers may
 * differ. Recorded here as one table so correcting them is a single edit.
 */
export const SKU_PRICE_PER_1000_USD: Record<string, number> = {
  ESSENTIALS: 0,
  PRO: 32,
  ENTERPRISE: 35,
  ENTERPRISE_ATMOSPHERE: 40,
  /** Geocoding is billed separately and is a rounding error next to Places. */
  GEOCODING: 5,
};

/** Cost in USD of `calls` requests billed at `tier`. */
export function costOfCalls(tier: string, calls: number): number {
  return ((SKU_PRICE_PER_1000_USD[tier] ?? 0) * calls) / 1000;
}
