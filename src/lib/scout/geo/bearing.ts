/**
 * Initial great-circle bearing, and the compass word for it.
 *
 * Used by the phone's competitor screen, whose dark card reads
 * "0.6 km · North-east". "North-east" is a real derived fact — it is what a
 * salesperson standing on the plot turns towards — where a drive time would
 * not be: this build integrates no routing API, and inventing "4 min drive"
 * would put a number on the screen nobody measured.
 *
 * Pure. No clock, no I/O.
 */

import type { LatLng } from "./distance";

const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/** Degrees clockwise from true north, 0–360. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = from.lat * TO_RAD;
  const lat2 = to.lat * TO_RAD;
  const dLng = (to.lng - from.lng) * TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) * TO_DEG + 360) % 360;
}

const COMPASS = [
  "North",
  "North-east",
  "East",
  "South-east",
  "South",
  "South-west",
  "West",
  "North-west",
] as const;

/** Eight-point compass word. `"North"` for a bearing within 22.5° of due north. */
export function compassDirection(from: LatLng, to: LatLng): string {
  const index = Math.round(bearingDegrees(from, to) / 45) % 8;
  return COMPASS[index] ?? "North";
}
