/**
 * Catchment tiling — the fix for the 20-result cap.
 *
 * Google's Places API (New) returns at most 20 results from a Nearby Search
 * and at most 60 from a paginated Text Search. One query over a 2 km circle in
 * Indiranagar therefore reports "20 schools" whether the true answer is 20 or
 * 200, and nothing in the response says which. Every count v16 produced was
 * silently a floor.
 *
 * The fix is to stop asking one big question. We cover the catchment circle
 * with many small overlapping circles, each small enough that a single
 * category is unlikely to saturate inside it, and ask each one separately.
 *
 * ## Why a triangular lattice
 *
 * Tile centres sit on a triangular (hexagonal) lattice, which is the provably
 * optimal covering of the plane by equal circles — it needs ~21 % fewer
 * circles than a square grid for the same guarantee. Since every tile is a
 * billable Google call, that ratio is money.
 *
 * For a triangular lattice of spacing `d`, discs of radius `r` centred on the
 * lattice points cover the whole plane **iff** `r ≥ d / √3`. The worst-covered
 * point is the circumcentre of a lattice triangle, exactly `d / √3` from its
 * three nearest centres. We therefore choose
 *
 *     d = r · √3 · (1 − overlap)
 *
 * so the deepest candidate point sits at `r · (1 − overlap)` — strictly inside
 * the tile, with `overlap` as the safety margin absorbing the planar
 * projection error and Google's own edge behaviour.
 *
 * This module is **pure**: no I/O, no clock, no randomness. Same inputs, same
 * tiles, forever. That is what lets a scan resume at tile 6 of 8 rather than
 * restart.
 */

import { haversineDistanceM, offsetMetres, type LatLng } from "./distance";

/** Google rejects a `locationRestriction` circle radius above this. */
export const GOOGLE_MAX_SEARCH_RADIUS_M = 50_000;

/** Below this a tile is smaller than the positional noise in Google's data. */
export const MIN_TILE_RADIUS_M = 50;

/**
 * Refuse to plan more tiles than this. A misconfigured tile radius turns one
 * scan into thousands of billable calls; failing loudly beats a surprise
 * invoice. Overridable per call for deliberate large sweeps.
 */
export const DEFAULT_MAX_TILES = 400;

/** Default safety margin, as a fraction of the tile radius. Matches the brief. */
export const DEFAULT_TILE_OVERLAP = 0.3;

/** √3, hoisted so the covering condition reads as the maths it is. */
const SQRT3 = Math.sqrt(3);

export interface TilePlanOptions {
  /** Catchment centre. */
  readonly centre: LatLng;
  /** Catchment radius in metres. Every returned tile helps cover this circle. */
  readonly radiusM: number;
  /** Radius of each search tile in metres. Smaller = more calls, less truncation. */
  readonly tileRadiusM: number;
  /**
   * Fraction of the tile radius held back as safety margin, `0 ≤ overlap < 1`.
   * `0` is the exact mathematical covering with no slack.
   */
  readonly overlap?: number;
  /** Hard ceiling on tile count. Defaults to {@link DEFAULT_MAX_TILES}. */
  readonly maxTiles?: number;
}

export interface Tile {
  /** Stable ordinal, assigned after sorting. Used as the resume cursor. */
  readonly index: number;
  readonly centre: LatLng;
  /** Search radius to send to Google for this tile. */
  readonly radiusM: number;
  /** Geodesic metres from the catchment centre to this tile's centre. */
  readonly distanceFromCentreM: number;
}

export class TilePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TilePlanError";
  }
}

/** Lattice geometry shared by the planner and the counter, so they cannot drift. */
interface Lattice {
  readonly spacingM: number;
  readonly rowHeightM: number;
  /** A tile beyond this cannot intersect the catchment, so it covers nothing. */
  readonly reachM: number;
  readonly maxRow: number;
}

function lattice(radiusM: number, tileRadiusM: number, overlap: number): Lattice {
  const spacingM = tileRadiusM * SQRT3 * (1 - overlap);
  const rowHeightM = (spacingM * SQRT3) / 2;
  const reachM = radiusM + tileRadiusM;
  return { spacingM, rowHeightM, reachM, maxRow: Math.floor(reachM / rowHeightM) };
}

/**
 * Inclusive column range for one lattice row, or `null` if the row misses the
 * catchment entirely. Shared by {@link planTiles} and {@link countTiles} so the
 * count is exactly what the planner will produce, never an approximation.
 */
function columnRange(l: Lattice, row: number): { from: number; to: number } | null {
  const northM = row * l.rowHeightM;
  // `maxRow` already guarantees |northM| <= reachM, so the radicand is
  // non-negative by construction; the clamp only absorbs floating-point dust
  // on the outermost row. Deliberately not a branch — an unreachable `if`
  // here would be a permanent hole in this module's branch coverage.
  const halfWidthM = Math.sqrt(Math.max(0, l.reachM * l.reachM - northM * northM));
  const rowOffsetM = row % 2 === 0 ? 0 : l.spacingM / 2;

  const from = Math.ceil((-halfWidthM - rowOffsetM) / l.spacingM);
  const to = Math.floor((halfWidthM - rowOffsetM) / l.spacingM);
  return to < from ? null : { from, to };
}

function validate(options: TilePlanOptions): { overlap: number; maxTiles: number } {
  const { centre, radiusM, tileRadiusM } = options;
  const overlap = options.overlap ?? DEFAULT_TILE_OVERLAP;
  const maxTiles = options.maxTiles ?? DEFAULT_MAX_TILES;

  if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lng)) {
    throw new TilePlanError(`centre must be a finite lat/lng, got ${JSON.stringify(centre)}`);
  }
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    throw new TilePlanError(`radiusM must be a positive number, got ${radiusM}`);
  }
  if (radiusM > GOOGLE_MAX_SEARCH_RADIUS_M) {
    throw new TilePlanError(
      `radiusM ${radiusM} exceeds Google's maximum search radius of ${GOOGLE_MAX_SEARCH_RADIUS_M} m`,
    );
  }
  if (!Number.isFinite(tileRadiusM) || tileRadiusM < MIN_TILE_RADIUS_M) {
    throw new TilePlanError(`tileRadiusM must be at least ${MIN_TILE_RADIUS_M} m, got ${tileRadiusM}`);
  }
  if (!Number.isFinite(overlap) || overlap < 0 || overlap >= 1) {
    throw new TilePlanError(`overlap must satisfy 0 <= overlap < 1, got ${overlap}`);
  }
  if (!Number.isInteger(maxTiles) || maxTiles < 1) {
    throw new TilePlanError(`maxTiles must be a positive integer, got ${maxTiles}`);
  }
  return { overlap, maxTiles };
}

/**
 * Exact number of tiles {@link planTiles} would return, computed without
 * building them.
 *
 * The cost estimator runs on every keystroke as the surveyor ticks categories,
 * so it must not allocate a few hundred tile objects to answer "how many
 * calls is this?". Cost is O(rows), not O(tiles).
 */
export function countTiles(radiusM: number, tileRadiusM: number, overlap = DEFAULT_TILE_OVERLAP): number {
  if (tileRadiusM >= radiusM) return 1;

  const l = lattice(radiusM, tileRadiusM, overlap);
  let total = 0;
  for (let row = -l.maxRow; row <= l.maxRow; row += 1) {
    const range = columnRange(l, row);
    if (range) total += range.to - range.from + 1;
  }
  return total;
}

/**
 * Plan the tiles covering a catchment circle.
 *
 * Guarantees, all exercised in `tiling.test.ts`:
 *  - every point inside the catchment lies within `tileRadiusM` of at least
 *    one returned tile centre — no gaps, verified geodesically;
 *  - no returned tile is useless: every tile's disc meets the catchment;
 *  - tiles are ordered nearest-centre-first, so a partially completed scan has
 *    already covered the most relevant ground;
 *  - output is deterministic.
 */
export function planTiles(options: TilePlanOptions): Tile[] {
  const { centre, radiusM, tileRadiusM } = options;
  const { overlap, maxTiles } = validate(options);

  // One tile already covers everything. Search the catchment radius directly
  // rather than an oversized tile — a bigger circle only buys noise to filter.
  if (tileRadiusM >= radiusM) {
    return [{ index: 0, centre, radiusM, distanceFromCentreM: 0 }];
  }

  const planned = countTiles(radiusM, tileRadiusM, overlap);
  if (planned > maxTiles) {
    throw new TilePlanError(
      `tile plan needs ${planned} tiles, over the limit of ${maxTiles}. ` +
        `Increase tileRadiusM, reduce radiusM, or raise maxTiles deliberately.`,
    );
  }

  const l = lattice(radiusM, tileRadiusM, overlap);
  const candidates: Array<{ centre: LatLng; planarM: number; geodesicM: number }> = [];

  for (let row = -l.maxRow; row <= l.maxRow; row += 1) {
    const range = columnRange(l, row);
    if (!range) continue;

    const northM = row * l.rowHeightM;
    const rowOffsetM = row % 2 === 0 ? 0 : l.spacingM / 2;

    for (let col = range.from; col <= range.to; col += 1) {
      const eastM = col * l.spacingM + rowOffsetM;
      const tileCentre = offsetMetres(centre, eastM, northM);
      candidates.push({
        centre: tileCentre,
        planarM: Math.hypot(eastM, northM),
        geodesicM: haversineDistanceM(centre, tileCentre),
      });
    }
  }

  // Nearest first, so a scan interrupted at tile 6 of 8 has covered the core.
  // Sorted on the geodesic distance rather than the planar one: the two differ
  // by up to half a percent (haversine is spherical, the per-degree scale
  // factors are ellipsoidal) and the ordering the caller sees should match the
  // distance the caller is shown. Ties break on coordinates so the order is
  // byte-stable across runs — a resumed scan must re-plan the identical list.
  candidates.sort(
    (a, b) => a.geodesicM - b.geodesicM || a.centre.lat - b.centre.lat || a.centre.lng - b.centre.lng,
  );

  return candidates.map((c, index) => ({
    index,
    centre: c.centre,
    radiusM: tileRadiusM,
    distanceFromCentreM: c.geodesicM,
  }));
}
