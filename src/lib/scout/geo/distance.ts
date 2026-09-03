/**
 * Geodesic helpers.
 *
 * Everything the ingestion pipeline measures — "is this place inside the
 * catchment", "how far apart are two tile centres" — is measured here, once,
 * on the sphere. No caller does its own trigonometry.
 *
 * Pure functions with no I/O: safe to import from anywhere, including tests
 * and (if ever needed) the browser.
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * IUGG mean Earth radius. Haversine on this value is accurate to roughly
 * 0.3 % worst case and far better than that over the ≤ 5 km distances this
 * project deals in — well inside the tiling overlap margin.
 */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG = Math.PI / 180;

/** Great-circle distance in metres between two points. */
export function haversineDistanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Metres per degree of latitude at `lat`, WGS84 series expansion.
 * Varies from ~110 574 m at the equator to ~111 694 m at the poles, so the
 * constant-111 320 shortcut is worth about a kilometre of error at 100 km.
 */
export function metresPerDegreeLat(lat: number): number {
  const phi = lat * DEG;
  return 111_132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi);
}

/** Metres per degree of longitude at `lat`, WGS84 series expansion. */
export function metresPerDegreeLng(lat: number): number {
  const phi = lat * DEG;
  return 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
}

/**
 * Move `origin` by a local east/north offset in metres.
 *
 * A local equirectangular projection about `origin`. Longitude scaling uses
 * the mean of the origin and destination latitudes, which keeps the residual
 * error below a metre over the ≤ 10 km offsets the tiler produces. The tiling
 * overlap margin exists partly to absorb exactly this.
 */
export function offsetMetres(origin: LatLng, eastM: number, northM: number): LatLng {
  const lat = origin.lat + northM / metresPerDegreeLat(origin.lat);
  const meanLat = (origin.lat + lat) / 2;
  const mPerDegLng = metresPerDegreeLng(meanLat);

  // Within ~1 m of a pole the longitude scale collapses; refuse rather than
  // emit Infinity. Nothing in this product operates there.
  if (Math.abs(mPerDegLng) < 1) {
    throw new RangeError(`offsetMetres: latitude ${origin.lat} is too close to a pole to project`);
  }

  return { lat, lng: origin.lng + eastM / mPerDegLng };
}

export interface BoundingBox {
  /** South-west corner. */
  readonly low: LatLng;
  /** North-east corner. */
  readonly high: LatLng;
}

/**
 * Axis-aligned box that fully contains the circle of `radiusM` around
 * `centre`. Used for `searchText`, whose `locationRestriction` accepts a
 * rectangle and never a circle (see docs/PHASE-1-UNVERIFIED.md, V2).
 *
 * The box circumscribes the circle, so results must still be filtered by true
 * geodesic distance afterwards — the corners lie up to √2 × radius out.
 */
export function boundingBox(centre: LatLng, radiusM: number): BoundingBox {
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    throw new RangeError(`boundingBox: radiusM must be a positive number, got ${radiusM}`);
  }
  const dLat = radiusM / metresPerDegreeLat(centre.lat);
  const north = clampLat(centre.lat + dLat);
  const south = clampLat(centre.lat - dLat);

  // Longitude spread is widest at whichever edge is nearer a pole.
  const widestLat = Math.abs(north) > Math.abs(south) ? north : south;
  const mPerDegLng = metresPerDegreeLng(widestLat);
  const dLng = Math.abs(mPerDegLng) < 1 ? 180 : radiusM / Math.abs(mPerDegLng);

  return {
    low: { lat: south, lng: clampLng(centre.lng - dLng) },
    high: { lat: north, lng: clampLng(centre.lng + dLng) },
  };
}

function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

function clampLng(lng: number): number {
  return Math.max(-180, Math.min(180, lng));
}

/** True when `point` lies within `radiusM` of `centre`, measured geodesically. */
export function isWithinRadius(centre: LatLng, point: LatLng, radiusM: number): boolean {
  return haversineDistanceM(centre, point) <= radiusM;
}

/** Guard for values arriving from Google or from a request body. */
export function isValidLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as Partial<LatLng>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
