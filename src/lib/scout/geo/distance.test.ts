import { describe, expect, it } from "vitest";

import {
  boundingBox,
  EARTH_RADIUS_M,
  haversineDistanceM,
  isValidLatLng,
  isWithinRadius,
  metresPerDegreeLat,
  metresPerDegreeLng,
  offsetMetres,
  type LatLng,
} from "./distance";

const INDIRANAGAR: LatLng = { lat: 12.9784, lng: 77.6408 };
const MG_ROAD: LatLng = { lat: 12.9716, lng: 77.5946 };

describe("haversineDistanceM", () => {
  it("is zero for identical points", () => {
    expect(haversineDistanceM(INDIRANAGAR, INDIRANAGAR)).toBe(0);
  });

  it("matches the known Indiranagar → MG Road distance", () => {
    // Pinned so a change of Earth radius or a formula rewrite is visible.
    // PostGIS `ST_DistanceSphere` on the same pair agrees to within a metre.
    expect(haversineDistanceM(INDIRANAGAR, MG_ROAD)).toBeCloseTo(5_062.8, 1);
  });

  it("is symmetric", () => {
    expect(haversineDistanceM(INDIRANAGAR, MG_ROAD)).toBeCloseTo(
      haversineDistanceM(MG_ROAD, INDIRANAGAR),
      9,
    );
  });

  it("gives a quarter meridian for equator to pole", () => {
    const quarter = (Math.PI / 2) * EARTH_RADIUS_M;
    expect(haversineDistanceM({ lat: 0, lng: 0 }, { lat: 90, lng: 0 })).toBeCloseTo(quarter, 3);
  });

  it("handles antipodal points without NaN from a square root of a negative", () => {
    const half = Math.PI * EARTH_RADIUS_M;
    expect(haversineDistanceM({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(half, 3);
    expect(haversineDistanceM({ lat: 45, lng: 10 }, { lat: -45, lng: -170 })).toBeCloseTo(half, 3);
  });

  it("crosses the antimeridian by the short way round", () => {
    const d = haversineDistanceM({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(d).toBeLessThan(25_000);
  });
});

describe("per-degree scale factors", () => {
  it("puts a degree of latitude near 110.6 km at the equator and 111.7 km at the pole", () => {
    expect(metresPerDegreeLat(0)).toBeCloseTo(110_574, -2);
    expect(metresPerDegreeLat(90)).toBeCloseTo(111_694, -2);
  });

  it("puts a degree of longitude near 111.3 km at the equator and zero at the pole", () => {
    expect(metresPerDegreeLng(0)).toBeCloseTo(111_320, -2);
    expect(Math.abs(metresPerDegreeLng(90))).toBeLessThan(100);
  });

  it("shrinks longitude spacing with the cosine of latitude", () => {
    expect(metresPerDegreeLng(60)).toBeCloseTo(metresPerDegreeLng(0) / 2, -3);
  });
});

describe("offsetMetres", () => {
  it("returns the origin for a zero offset", () => {
    expect(offsetMetres(INDIRANAGAR, 0, 0)).toEqual(INDIRANAGAR);
  });

  it("round-trips through haversine to within half a percent", () => {
    for (const [east, north] of [
      [1_000, 0],
      [0, 1_000],
      [-2_000, 3_000],
      [800, -800],
    ] as const) {
      const moved = offsetMetres(INDIRANAGAR, east, north);
      const expected = Math.hypot(east, north);
      // The residual is the spherical-vs-ellipsoidal mismatch: haversine
      // measures on a sphere, the per-degree scale factors are WGS84. Half a
      // percent is the budget, and the tiling overlap margin covers it.
      expect(Math.abs(haversineDistanceM(INDIRANAGAR, moved) - expected)).toBeLessThan(
        expected * 0.006,
      );
    }
  });

  it("moves north for a positive north offset and east for a positive east offset", () => {
    expect(offsetMetres(INDIRANAGAR, 0, 500).lat).toBeGreaterThan(INDIRANAGAR.lat);
    expect(offsetMetres(INDIRANAGAR, 500, 0).lng).toBeGreaterThan(INDIRANAGAR.lng);
  });

  it("refuses to project at the pole rather than returning Infinity", () => {
    expect(() => offsetMetres({ lat: 90, lng: 0 }, 100, 0)).toThrow(RangeError);
  });
});

describe("boundingBox", () => {
  it("circumscribes the circle — every edge is at least the radius away", () => {
    const box = boundingBox(INDIRANAGAR, 2_000);
    expect(haversineDistanceM(INDIRANAGAR, { lat: box.high.lat, lng: INDIRANAGAR.lng })).toBeGreaterThan(
      1_990,
    );
    expect(haversineDistanceM(INDIRANAGAR, { lat: INDIRANAGAR.lng, lng: box.high.lng })).toBeGreaterThan(
      0,
    );
    expect(box.low.lat).toBeLessThan(INDIRANAGAR.lat);
    expect(box.high.lat).toBeGreaterThan(INDIRANAGAR.lat);
    expect(box.low.lng).toBeLessThan(INDIRANAGAR.lng);
    expect(box.high.lng).toBeGreaterThan(INDIRANAGAR.lng);
  });

  it("contains every point on the circle it circumscribes", () => {
    const radiusM = 2_000;
    const box = boundingBox(INDIRANAGAR, radiusM);
    for (let deg = 0; deg < 360; deg += 3) {
      const theta = (deg * Math.PI) / 180;
      const p = offsetMetres(INDIRANAGAR, radiusM * Math.cos(theta), radiusM * Math.sin(theta));
      expect(p.lat).toBeGreaterThanOrEqual(box.low.lat);
      expect(p.lat).toBeLessThanOrEqual(box.high.lat);
      expect(p.lng).toBeGreaterThanOrEqual(box.low.lng);
      expect(p.lng).toBeLessThanOrEqual(box.high.lng);
    }
  });

  it("clamps rather than wrapping past the poles", () => {
    const box = boundingBox({ lat: 89.99, lng: 0 }, 5_000);
    expect(box.high.lat).toBe(90);
    expect(box.low.lng).toBeGreaterThanOrEqual(-180);
    expect(box.high.lng).toBeLessThanOrEqual(180);
  });

  it("widens to the whole longitude span when the box reaches the pole", () => {
    const box = boundingBox({ lat: 90, lng: 0 }, 5_000);
    expect(box.high.lng - box.low.lng).toBeGreaterThan(300);
  });

  it("clamps longitude at the antimeridian", () => {
    const box = boundingBox({ lat: 0, lng: 179.999 }, 5_000);
    expect(box.high.lng).toBe(180);
  });

  it("rejects a non-positive radius", () => {
    expect(() => boundingBox(INDIRANAGAR, 0)).toThrow(RangeError);
    expect(() => boundingBox(INDIRANAGAR, -1)).toThrow(RangeError);
    expect(() => boundingBox(INDIRANAGAR, Number.NaN)).toThrow(RangeError);
  });
});

describe("isWithinRadius", () => {
  it("includes a point exactly on the boundary", () => {
    const edge = offsetMetres(INDIRANAGAR, 1_000, 0);
    const d = haversineDistanceM(INDIRANAGAR, edge);
    expect(isWithinRadius(INDIRANAGAR, edge, d)).toBe(true);
    expect(isWithinRadius(INDIRANAGAR, edge, d - 0.001)).toBe(false);
  });

  it("excludes a place outside the catchment", () => {
    expect(isWithinRadius(INDIRANAGAR, MG_ROAD, 2_000)).toBe(false);
    expect(isWithinRadius(INDIRANAGAR, MG_ROAD, 6_000)).toBe(true);
  });
});

describe("isValidLatLng", () => {
  it.each([
    [{ lat: 0, lng: 0 }, true],
    [{ lat: 12.9784, lng: 77.6408 }, true],
    [{ lat: -90, lng: -180 }, true],
    [{ lat: 90, lng: 180 }, true],
    [{ lat: 90.1, lng: 0 }, false],
    [{ lat: -90.1, lng: 0 }, false],
    [{ lat: 0, lng: 180.1 }, false],
    [{ lat: 0, lng: -180.1 }, false],
    [{ lat: Number.NaN, lng: 0 }, false],
    [{ lat: 0, lng: Number.POSITIVE_INFINITY }, false],
    [{ lat: "12", lng: 77 }, false],
    [{ lat: 12 }, false],
    [{}, false],
    [null, false],
    [undefined, false],
    ["12,77", false],
    [42, false],
  ])("classifies %j as %s", (value, expected) => {
    expect(isValidLatLng(value)).toBe(expected);
  });
});
