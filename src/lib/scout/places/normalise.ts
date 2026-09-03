/**
 * Google's wire shape → our row shape.
 *
 * The only place a `GooglePlace` is allowed to become a `places` row. Two
 * things it is strict about:
 *
 * - **Absent is not zero.** A Pro-tier search returns no `rating`, and turning
 *   that into `0` would drag the catchment average down and corrupt score
 *   component 3. Missing fields stay `null`.
 * - **The operating window is derived, not guessed.** A competitor open until
 *   11 pm is a different competitor from one closing at 8 pm — that is the
 *   entire 7–11 pm revenue window, which the client flagged as close to a
 *   deal-breaker for their own sites (`CLIENT-INPUTS.md` D6).
 */

import { isValidLatLng, type LatLng } from "@/lib/scout/geo/distance";

import type { GoogleOpeningHours, GooglePlace, GooglePriceLevel, GoogleReview } from "./googleTypes";

/** `PRICE_LEVEL_*` → 0–4, matching the legacy `price_level` smallint. */
const PRICE_LEVELS: Record<GooglePriceLevel, number | null> = {
  PRICE_LEVEL_UNSPECIFIED: null,
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export interface OperatingWindow {
  /** Earliest opening minute-of-day across the week, or null if unknown. */
  readonly earliestOpenMinute: number | null;
  /** Latest closing minute-of-day across the week, or null if unknown. */
  readonly latestCloseMinute: number | null;
  /** Opens before 07:00 on at least one day — the morning fitness crowd. */
  readonly opensEarly: boolean;
  /** Closes at or after 22:00 on at least one day — holds the evening peak. */
  readonly closesLate: boolean;
  /** Has any Sunday hours at all. */
  readonly openSunday: boolean;
  /** Days of the week with at least one open period, 0 = Sunday. */
  readonly openDays: number[];
  /** Longest single open period in minutes, across the week. */
  readonly longestSessionMinutes: number | null;
  /** True when Google reports the place open 24 h (a period with no close). */
  readonly alwaysOpen: boolean;
}

export const UNKNOWN_OPERATING_WINDOW: OperatingWindow = {
  earliestOpenMinute: null,
  latestCloseMinute: null,
  opensEarly: false,
  closesLate: false,
  openSunday: false,
  openDays: [],
  longestSessionMinutes: null,
  alwaysOpen: false,
};

const EARLY_MINUTE = 7 * 60;
const LATE_MINUTE = 22 * 60;
const MINUTES_PER_DAY = 24 * 60;

/**
 * Collapse Google's `regularOpeningHours.periods` into the handful of facts the
 * score and the report actually use.
 *
 * Periods that close past midnight come back with a lower `close` than `open`
 * (a turf open 06:00–01:00 reports close day+1 at 01:00). Those are rolled
 * forward a day so "closes late" is true rather than "closes at 1 am, which is
 * earlier than 6 am, therefore closes early".
 */
export function deriveOperatingWindow(hours: GoogleOpeningHours | undefined): OperatingWindow {
  const periods = hours?.periods;
  if (!periods || periods.length === 0) return UNKNOWN_OPERATING_WINDOW;

  let earliestOpenMinute: number | null = null;
  let latestCloseMinute: number | null = null;
  let longestSessionMinutes: number | null = null;
  let alwaysOpen = false;
  const openDays = new Set<number>();

  for (const period of periods) {
    const open = period.open;
    if (!open || typeof open.day !== "number") continue;

    openDays.add(open.day);
    const openMinute = (open.hour ?? 0) * 60 + (open.minute ?? 0);
    earliestOpenMinute = earliestOpenMinute === null ? openMinute : Math.min(earliestOpenMinute, openMinute);

    // Google omits `close` entirely for a place that never closes.
    if (!period.close) {
      alwaysOpen = true;
      latestCloseMinute = MINUTES_PER_DAY;
      longestSessionMinutes = MINUTES_PER_DAY;
      continue;
    }

    let closeMinute = (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0);
    if (closeMinute <= openMinute) closeMinute += MINUTES_PER_DAY;

    latestCloseMinute = latestCloseMinute === null ? closeMinute : Math.max(latestCloseMinute, closeMinute);
    const session = closeMinute - openMinute;
    longestSessionMinutes =
      longestSessionMinutes === null ? session : Math.max(longestSessionMinutes, session);
  }

  if (earliestOpenMinute === null) return UNKNOWN_OPERATING_WINDOW;

  return {
    earliestOpenMinute,
    latestCloseMinute,
    opensEarly: earliestOpenMinute < EARLY_MINUTE,
    closesLate: latestCloseMinute !== null && latestCloseMinute >= LATE_MINUTE,
    openSunday: openDays.has(0),
    openDays: [...openDays].sort((a, b) => a - b),
    longestSessionMinutes,
    alwaysOpen,
  };
}

export interface NormalisedReview {
  readonly googleReviewId: string | null;
  readonly authorName: string | null;
  readonly rating: number | null;
  readonly text: string | null;
  readonly languageCode: string | null;
  readonly publishedAt: Date | null;
}

export interface NormalisedPlace {
  readonly placeId: string;
  readonly name: string;
  readonly location: LatLng;
  readonly rating: number | null;
  readonly reviewCount: number | null;
  readonly address: string | null;
  readonly hours: GoogleOpeningHours | null;
  readonly operatingWindow: OperatingWindow;
  readonly priceLevel: number | null;
  readonly website: string | null;
  readonly phone: string | null;
  readonly googleTypes: string[];
  readonly primaryType: string | null;
  readonly primaryTypeDisplayName: string | null;
  readonly googleMapsUri: string | null;
  readonly businessStatus: string | null;
  readonly reviews: NormalisedReview[];
}

/**
 * Normalise one place, or `null` if it is unusable.
 *
 * Unusable means no id or no valid coordinate — either makes the row
 * impossible to dedupe or impossible to place on the map. Dropping it beats
 * persisting a row that fails the distance filter with `NaN`.
 */
export function normalisePlace(place: GooglePlace): NormalisedPlace | null {
  const placeId = place.id ?? place.name?.replace(/^places\//, "");
  if (!placeId) return null;

  const location = place.location
    ? { lat: place.location.latitude, lng: place.location.longitude }
    : null;
  if (!isValidLatLng(location)) return null;

  return {
    placeId,
    name: place.displayName?.text?.trim() || "(unnamed)",
    location,
    rating: numberOrNull(place.rating),
    reviewCount: numberOrNull(place.userRatingCount),
    address: place.formattedAddress?.trim() || null,
    hours: place.regularOpeningHours ?? null,
    operatingWindow: deriveOperatingWindow(place.regularOpeningHours),
    priceLevel: place.priceLevel ? (PRICE_LEVELS[place.priceLevel] ?? null) : null,
    website: place.websiteUri?.trim() || null,
    phone: place.nationalPhoneNumber?.trim() || place.internationalPhoneNumber?.trim() || null,
    googleTypes: place.types ?? [],
    primaryType: place.primaryType ?? null,
    primaryTypeDisplayName: place.primaryTypeDisplayName?.text ?? null,
    googleMapsUri: place.googleMapsUri ?? null,
    businessStatus: place.businessStatus ?? null,
    reviews: (place.reviews ?? []).map(normaliseReview).slice(0, 5),
  };
}

function normaliseReview(review: GoogleReview): NormalisedReview {
  const published = review.publishTime ? new Date(review.publishTime) : null;
  return {
    googleReviewId: review.name ?? null,
    authorName: review.authorAttribution?.displayName ?? null,
    rating: numberOrNull(review.rating),
    // Prefer `originalText`: Phase 3's theme extraction reads better on the
    // reviewer's own words than on Google's machine translation of them.
    text: review.originalText?.text?.trim() || review.text?.text?.trim() || null,
    languageCode: review.originalText?.languageCode ?? review.text?.languageCode ?? null,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
  };
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
