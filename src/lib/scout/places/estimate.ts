/**
 * Cost estimator.
 *
 * The scan screen shows this live as categories are ticked, because a Full
 * sweep is roughly five times a Quick check and the surveyor should learn that
 * before running the scan, not from the invoice. v16 showed "N searches per
 * scan"; this states calls, money and time.
 *
 * Pure and synchronous — it runs on every keystroke, so it counts tiles with
 * the closed-form `countTiles` rather than materialising a few hundred tile
 * objects.
 */

import { countTiles } from "@/lib/scout/geo/tiling";

import { costOfCalls, PLACES_DEFAULTS, TEXT_MAX_PAGES } from "./config";
import { resolveTerms, type SkuTier } from "./taxonomy";

export interface EstimateOptions {
  readonly categoryIds: readonly string[];
  readonly radiusM: number;
  readonly tileRadiusM?: number;
  readonly tileOverlap?: number;
  /** Parallel in-flight Google calls. Drives the duration estimate only. */
  readonly concurrency?: number;
  /** Assumed round-trip per call, ms. Replace with the measured value (V4). */
  readonly avgCallLatencyMs?: number;
  /**
   * Expected share of places already in the cache, 0–1. A repeat scan of an
   * overlapping area is substantially cheaper; a first scan of new ground is
   * not. Defaults to 0 so the quoted figure is the worst case.
   */
  readonly cacheHitRate?: number;
}

export interface ScanEstimate {
  readonly tiles: number;
  readonly terms: number;
  readonly nearbyTerms: number;
  readonly textTerms: number;
  /** Guaranteed number of billable calls — one per tile per term. */
  readonly minCalls: number;
  /**
   * Worst case: every text term paginates to Google's 60-result ceiling on
   * every tile. Dense urban areas approach this; empty ones do not.
   */
  readonly maxCalls: number;
  readonly minCostUsd: number;
  readonly maxCostUsd: number;
  /** Per-tier call counts, so the UI can explain why Atmosphere terms cost more. */
  readonly callsByTier: Readonly<Record<string, number>>;
  readonly estimatedDurationMs: number;
  /** True when the plan exceeds the configured tile ceiling and will be refused. */
  readonly exceedsTileLimit: boolean;
}

const AVG_CALL_LATENCY_MS = 450;

/**
 * Estimate the cost and duration of a scan.
 *
 * Never throws: the scan screen calls this while the surveyor is still
 * dragging the radius slider, and a thrown error there is a blank panel. An
 * impossible plan comes back with `exceedsTileLimit` set instead.
 */
export function estimateScan(options: EstimateOptions): ScanEstimate {
  const tileRadiusM = options.tileRadiusM ?? PLACES_DEFAULTS.tileRadiusM;
  const tileOverlap = options.tileOverlap ?? PLACES_DEFAULTS.tileOverlap;
  const concurrency = Math.max(1, options.concurrency ?? PLACES_DEFAULTS.concurrency);
  const latency = options.avgCallLatencyMs ?? AVG_CALL_LATENCY_MS;
  const cacheHitRate = Math.min(1, Math.max(0, options.cacheHitRate ?? 0));

  const radiusM = Number.isFinite(options.radiusM) && options.radiusM > 0 ? options.radiusM : 0;
  const tiles = radiusM === 0 ? 0 : countTiles(radiusM, tileRadiusM, tileOverlap);
  const terms = resolveTerms(options.categoryIds);

  const nearbyTerms = terms.filter((t) => t.term.mode === "nearby").length;
  const textTerms = terms.length - nearbyTerms;

  const minByTier: Record<string, number> = {};
  const maxByTier: Record<string, number> = {};
  let minCalls = 0;
  let maxCalls = 0;

  for (const resolved of terms) {
    // A text term issues one call per query string, then up to
    // TEXT_MAX_PAGES pages each; a nearby term is always exactly one call.
    const queries = resolved.term.mode === "text" ? (resolved.term.queries?.length ?? 1) : 1;
    const perTileMin = queries;
    const perTileMax = resolved.term.mode === "text" ? queries * TEXT_MAX_PAGES : 1;

    const tier: SkuTier = resolved.fields;
    minByTier[tier] = (minByTier[tier] ?? 0) + tiles * perTileMin;
    maxByTier[tier] = (maxByTier[tier] ?? 0) + tiles * perTileMax;
    minCalls += tiles * perTileMin;
    maxCalls += tiles * perTileMax;
  }

  // Cache hits skip the network entirely, so they cost nothing and take no time.
  const billableFactor = 1 - cacheHitRate;
  const minCostUsd = sumCost(minByTier, billableFactor);
  const maxCostUsd = sumCost(maxByTier, billableFactor);

  // Midway between best and worst is the honest headline number; quoting the
  // floor as "the cost" is how a surveyor gets surprised.
  const expectedCalls = ((minCalls + maxCalls) / 2) * billableFactor;
  const estimatedDurationMs = Math.round((expectedCalls / concurrency) * latency);

  return {
    tiles,
    terms: terms.length,
    nearbyTerms,
    textTerms,
    minCalls,
    maxCalls,
    minCostUsd: round4(minCostUsd),
    maxCostUsd: round4(maxCostUsd),
    callsByTier: minByTier,
    estimatedDurationMs,
    exceedsTileLimit: tiles > PLACES_DEFAULTS.maxTilesPerScan,
  };
}

function sumCost(byTier: Record<string, number>, factor: number): number {
  let total = 0;
  for (const [tier, calls] of Object.entries(byTier)) {
    total += costOfCalls(tier, calls * factor);
  }
  return total;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Human-readable duration for the scan screen: "about 2 min". */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return "under a second";
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `about ${seconds} s`;
  return `about ${Math.round(seconds / 60)} min`;
}
