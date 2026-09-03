/**
 * Catchment geometry. No database, no environment, no population — safe to
 * import from anywhere including client components.
 */

/**
 * Largest radius the catchment helpers accept, in metres.
 *
 * A guard against a unit mix-up, not a product limit. Scans run at 1–5 km; a
 * caller passing 5 000 000 has confused metres with something else and should
 * hear about it immediately rather than 40 seconds into a spatial query.
 */
export const MAX_CATCHMENT_RADIUS_M = 100_000;

export class InvalidCatchmentError extends Error {
  override readonly name = "InvalidCatchmentError";
}

/** Throws if the arguments could not describe a real catchment on Earth. */
export function assertValidCatchment(lat: number, lng: number, radiusM: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new InvalidCatchmentError(`Latitude must be a finite number in [-90, 90], got ${lat}.`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new InvalidCatchmentError(
      `Longitude must be a finite number in [-180, 180], got ${lng}.`,
    );
  }
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    throw new InvalidCatchmentError(
      `Radius must be a finite number greater than 0, got ${radiusM}.`,
    );
  }
  if (radiusM > MAX_CATCHMENT_RADIUS_M) {
    throw new InvalidCatchmentError(
      `Radius ${radiusM} m exceeds the ${MAX_CATCHMENT_RADIUS_M} m ceiling. Radii are in metres — check the units.`,
    );
  }
}

/**
 * Area of the catchment disc in km².
 *
 * `ST_DWithin` on `geography` measures geodesic distance, so the catchment is
 * strictly a spherical cap, whose area is `2πR²(1 − cos(r/R))`. At every radius
 * this application uses, that differs from the planar `πr²` by a factor of
 * roughly `r²/(12R²)` — about 5 parts in a hundred million at 5 km, and still
 * under 2 parts per million at the 100 km ceiling. `πr²` is therefore exact to
 * far beyond any precision a report prints.
 *
 * Rounded to three decimals so a float tail never leaks into a rendered figure.
 */
export function catchmentAreaKm2(radiusM: number): number {
  const km = radiusM / 1000;
  return Math.round(Math.PI * km * km * 1000) / 1000;
}
