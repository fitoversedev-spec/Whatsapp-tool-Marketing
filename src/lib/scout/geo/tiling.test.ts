/**
 * The tiling algorithm is the single most important piece of logic in the
 * ingestion pipeline: if it leaves a gap, the scan silently undercounts and
 * every downstream number is wrong in a way no one can see. These tests are
 * therefore adversarial about coverage rather than illustrative.
 *
 * Coverage is asserted with **geodesic** distance, never with the planar
 * offsets the planner used internally — that is the whole point. If the local
 * projection drifts, these tests fail.
 */
import { describe, expect, it } from "vitest";

import { haversineDistanceM, offsetMetres, type LatLng } from "./distance";
import {
  countTiles,
  DEFAULT_MAX_TILES,
  DEFAULT_TILE_OVERLAP,
  GOOGLE_MAX_SEARCH_RADIUS_M,
  MIN_TILE_RADIUS_M,
  planTiles,
  TilePlanError,
  type Tile,
} from "./tiling";

/** Indiranagar, Bengaluru — the dense area the acceptance criteria name. */
const INDIRANAGAR: LatLng = { lat: 12.9784, lng: 77.6408 };

/** A deterministic PRNG, so a failure is always reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Worst-case geodesic distance from `point` to its nearest tile centre. */
function distanceToNearestTile(tiles: readonly Tile[], point: LatLng): number {
  let best = Number.POSITIVE_INFINITY;
  for (const tile of tiles) {
    const d = haversineDistanceM(tile.centre, point);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Sample the catchment disc thoroughly: concentric rings (which catch radial
 * gaps), the boundary itself (the hardest case), and seeded random interior
 * points (which catch gaps a regular grid can step straight over).
 */
function sampleDisc(centre: LatLng, radiusM: number, seed: number): LatLng[] {
  const points: LatLng[] = [centre];
  const rings = 24;
  for (let ring = 1; ring <= rings; ring += 1) {
    const r = (radiusM * ring) / rings;
    const spokes = Math.max(24, Math.ceil((2 * Math.PI * r) / 40));
    for (let s = 0; s < spokes; s += 1) {
      const theta = (2 * Math.PI * s) / spokes;
      points.push(offsetMetres(centre, r * Math.cos(theta), r * Math.sin(theta)));
    }
  }
  const rand = mulberry32(seed);
  for (let i = 0; i < 4000; i += 1) {
    // sqrt() keeps the sample uniform over area rather than clustered at the centre.
    const r = radiusM * Math.sqrt(rand());
    const theta = 2 * Math.PI * rand();
    points.push(offsetMetres(centre, r * Math.cos(theta), r * Math.sin(theta)));
  }
  return points;
}

describe("planTiles — coverage", () => {
  const cases = [
    { label: "1 km catchment, 800 m tiles", radiusM: 1_000, tileRadiusM: 800 },
    { label: "2 km catchment, 800 m tiles", radiusM: 2_000, tileRadiusM: 800 },
    { label: "3 km catchment, 800 m tiles", radiusM: 3_000, tileRadiusM: 800 },
    { label: "5 km catchment, 800 m tiles", radiusM: 5_000, tileRadiusM: 800 },
    { label: "2 km catchment, 500 m tiles", radiusM: 2_000, tileRadiusM: 500 },
    { label: "2 km catchment, 1.9 km tiles (barely more than one)", radiusM: 2_000, tileRadiusM: 1_900 },
    { label: "awkward ratio", radiusM: 1_337, tileRadiusM: 613 },
  ];

  for (const { label, radiusM, tileRadiusM } of cases) {
    it(`${label} covers every sampled point with no gap`, () => {
      const tiles = planTiles({ centre: INDIRANAGAR, radiusM, tileRadiusM, maxTiles: 5_000 });
      expect(tiles.length).toBeGreaterThan(0);

      let worst = 0;
      for (const point of sampleDisc(INDIRANAGAR, radiusM, radiusM + tileRadiusM)) {
        const nearest = distanceToNearestTile(tiles, point);
        if (nearest > worst) worst = nearest;
      }

      // Not merely "inside the tile" — inside with the overlap margin intact.
      // A regression that ate the margin would still pass a bare `<= tileRadiusM`.
      expect(worst).toBeLessThanOrEqual(tileRadiusM);
      // 5 m of slack for the spherical-vs-ellipsoidal mismatch between the
      // haversine measurement here and the per-degree scale factors the
      // planner projects with. The overlap margin exists to absorb exactly this.
      expect(worst).toBeLessThanOrEqual(tileRadiusM * (1 - DEFAULT_TILE_OVERLAP) + 5);
    });
  }

  it("covers the catchment at zero overlap, the exact mathematical bound", () => {
    const tiles = planTiles({
      centre: INDIRANAGAR,
      radiusM: 2_000,
      tileRadiusM: 800,
      overlap: 0,
      maxTiles: 5_000,
    });
    let worst = 0;
    for (const point of sampleDisc(INDIRANAGAR, 2_000, 7)) {
      worst = Math.max(worst, distanceToNearestTile(tiles, point));
    }
    // At overlap 0 the deepest point sits exactly on the tile edge; allow a
    // metre for the projection, which is what the default overlap buys back.
    expect(worst).toBeLessThanOrEqual(800 + 1);
  });

  it("covers equally well near the equator and at high latitude", () => {
    for (const centre of [
      { lat: 0.0001, lng: 0 },
      { lat: 60, lng: -120 },
      { lat: -33.87, lng: 151.21 },
    ]) {
      const tiles = planTiles({ centre, radiusM: 2_000, tileRadiusM: 800, maxTiles: 5_000 });
      let worst = 0;
      for (const point of sampleDisc(centre, 2_000, 99)) {
        worst = Math.max(worst, distanceToNearestTile(tiles, point));
      }
      expect(worst).toBeLessThanOrEqual(800);
    }
  });
});

describe("planTiles — shape of the result", () => {
  it("returns exactly one tile when a tile already covers the catchment", () => {
    const tiles = planTiles({ centre: INDIRANAGAR, radiusM: 500, tileRadiusM: 800 });
    expect(tiles).toEqual([
      { index: 0, centre: INDIRANAGAR, radiusM: 500, distanceFromCentreM: 0 },
    ]);
  });

  it("uses the catchment radius, not the tile radius, for that single tile", () => {
    // Searching a larger circle than asked for would import places the scan
    // then has to throw away — pure waste at a billable price.
    const [tile] = planTiles({ centre: INDIRANAGAR, radiusM: 500, tileRadiusM: 5_000 });
    expect(tile!.radiusM).toBe(500);
  });

  it("treats tileRadiusM exactly equal to radiusM as the single-tile case", () => {
    expect(planTiles({ centre: INDIRANAGAR, radiusM: 800, tileRadiusM: 800 })).toHaveLength(1);
  });

  it("emits no tile that fails to touch the catchment", () => {
    const radiusM = 2_000;
    const tileRadiusM = 800;
    const tiles = planTiles({ centre: INDIRANAGAR, radiusM, tileRadiusM, maxTiles: 5_000 });
    for (const tile of tiles) {
      expect(tile.distanceFromCentreM).toBeLessThanOrEqual(radiusM + tileRadiusM);
    }
  });

  it("orders tiles nearest-centre-first so an interrupted scan covered the core", () => {
    const tiles = planTiles({ centre: INDIRANAGAR, radiusM: 3_000, tileRadiusM: 800, maxTiles: 5_000 });
    expect(tiles[0]!.distanceFromCentreM).toBeLessThan(1);
    for (let i = 1; i < tiles.length; i += 1) {
      expect(tiles[i]!.distanceFromCentreM).toBeGreaterThanOrEqual(tiles[i - 1]!.distanceFromCentreM);
    }
  });

  it("numbers tiles contiguously from zero", () => {
    const tiles = planTiles({ centre: INDIRANAGAR, radiusM: 2_000, tileRadiusM: 800, maxTiles: 5_000 });
    expect(tiles.map((t) => t.index)).toEqual(tiles.map((_, i) => i));
  });

  it("is deterministic — a resumed scan must re-plan the identical tiles", () => {
    const args = { centre: INDIRANAGAR, radiusM: 2_500, tileRadiusM: 800, maxTiles: 5_000 } as const;
    expect(planTiles(args)).toEqual(planTiles(args));
  });

  it("stamps every tile with the configured search radius", () => {
    const tiles = planTiles({ centre: INDIRANAGAR, radiusM: 2_000, tileRadiusM: 650, maxTiles: 5_000 });
    expect(new Set(tiles.map((t) => t.radiusM))).toEqual(new Set([650]));
  });

  it("needs fewer tiles as the tile radius grows", () => {
    const at = (tileRadiusM: number) =>
      planTiles({ centre: INDIRANAGAR, radiusM: 3_000, tileRadiusM, maxTiles: 20_000 }).length;
    expect(at(400)).toBeGreaterThan(at(800));
    expect(at(800)).toBeGreaterThan(at(1_500));
  });
});

describe("planTiles — rejected input", () => {
  const base = { centre: INDIRANAGAR, radiusM: 2_000, tileRadiusM: 800 };

  it.each([
    ["non-finite centre latitude", { ...base, centre: { lat: Number.NaN, lng: 77 } }],
    ["non-finite centre longitude", { ...base, centre: { lat: 12, lng: Number.POSITIVE_INFINITY } }],
    ["zero radius", { ...base, radiusM: 0 }],
    ["negative radius", { ...base, radiusM: -1 }],
    ["non-finite radius", { ...base, radiusM: Number.NaN }],
    ["radius beyond Google's maximum", { ...base, radiusM: GOOGLE_MAX_SEARCH_RADIUS_M + 1 }],
    ["tile radius below the floor", { ...base, tileRadiusM: MIN_TILE_RADIUS_M - 1 }],
    ["non-finite tile radius", { ...base, tileRadiusM: Number.NaN }],
    ["negative overlap", { ...base, overlap: -0.01 }],
    ["overlap of one", { ...base, overlap: 1 }],
    ["overlap above one", { ...base, overlap: 1.5 }],
    ["non-finite overlap", { ...base, overlap: Number.NaN }],
    ["fractional maxTiles", { ...base, maxTiles: 2.5 }],
    ["zero maxTiles", { ...base, maxTiles: 0 }],
  ])("rejects %s", (_label, options) => {
    expect(() => planTiles(options)).toThrow(TilePlanError);
  });

  it("accepts an undefined centre object rather than crashing on property access", () => {
    expect(() => planTiles({ ...base, centre: undefined as unknown as LatLng })).toThrow(TilePlanError);
  });

  it("refuses a plan that would exceed the tile ceiling", () => {
    expect(() => planTiles({ centre: INDIRANAGAR, radiusM: 5_000, tileRadiusM: 100 })).toThrow(
      /over the limit of 400/,
    );
  });

  it("allows the same plan when the ceiling is raised deliberately", () => {
    const tiles = planTiles({
      centre: INDIRANAGAR,
      radiusM: 5_000,
      tileRadiusM: 100,
      maxTiles: 50_000,
    });
    expect(tiles.length).toBeGreaterThan(DEFAULT_MAX_TILES);
  });

  it("permits the exact maximum radius Google accepts", () => {
    expect(() =>
      planTiles({ centre: INDIRANAGAR, radiusM: GOOGLE_MAX_SEARCH_RADIUS_M, tileRadiusM: 40_000 }),
    ).not.toThrow();
  });

  it("permits the exact minimum tile radius", () => {
    expect(() =>
      planTiles({ centre: INDIRANAGAR, radiusM: 200, tileRadiusM: MIN_TILE_RADIUS_M }),
    ).not.toThrow();
  });
});

describe("countTiles", () => {
  it("agrees exactly with planTiles — the cost estimate must not be a guess", () => {
    for (const [radiusM, tileRadiusM] of [
      [1_000, 800],
      [2_000, 800],
      [3_000, 800],
      [5_000, 800],
      [2_000, 500],
      [1_337, 613],
      [900, 450],
    ] as const) {
      expect(countTiles(radiusM, tileRadiusM)).toBe(
        planTiles({ centre: INDIRANAGAR, radiusM, tileRadiusM, maxTiles: 50_000 }).length,
      );
    }
  });

  it("agrees with planTiles at a non-default overlap", () => {
    expect(countTiles(2_000, 800, 0.1)).toBe(
      planTiles({ centre: INDIRANAGAR, radiusM: 2_000, tileRadiusM: 800, overlap: 0.1, maxTiles: 50_000 })
        .length,
    );
  });

  it("returns one when a single tile suffices", () => {
    expect(countTiles(500, 800)).toBe(1);
    expect(countTiles(800, 800)).toBe(1);
  });

  it("grows roughly with the square of the radius", () => {
    const one = countTiles(1_000, 800);
    const four = countTiles(4_000, 800);
    expect(four / one).toBeGreaterThan(4);
  });
});
