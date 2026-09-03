/**
 * Wire shapes for Places API (New) and the Geocoding API.
 *
 * Everything is optional because the response only ever contains what the
 * field mask asked for — a Pro-tier search returns no `rating`, and treating
 * that absence as "rating zero" would quietly corrupt score component 3. The
 * normaliser is the only place allowed to turn these into our row types.
 */

export interface GoogleLatLng {
  latitude: number;
  longitude: number;
}

export interface GoogleLocalizedText {
  text?: string;
  languageCode?: string;
}

export interface GoogleAuthorAttribution {
  displayName?: string;
  uri?: string;
  photoUri?: string;
}

export interface GoogleReview {
  /** Resource name, e.g. `places/ChIJ…/reviews/…`. The dedupe key. */
  name?: string;
  relativePublishTimeDescription?: string;
  text?: GoogleLocalizedText;
  originalText?: GoogleLocalizedText;
  rating?: number;
  authorAttribution?: GoogleAuthorAttribution;
  /** RFC 3339. */
  publishTime?: string;
}

export interface GoogleOpeningHoursPoint {
  /** 0 = Sunday … 6 = Saturday. */
  day?: number;
  hour?: number;
  minute?: number;
}

export interface GoogleOpeningHoursPeriod {
  open?: GoogleOpeningHoursPoint;
  close?: GoogleOpeningHoursPoint;
}

export interface GoogleOpeningHours {
  openNow?: boolean;
  periods?: GoogleOpeningHoursPeriod[];
  weekdayDescriptions?: string[];
}

export type GooglePriceLevel =
  | "PRICE_LEVEL_UNSPECIFIED"
  | "PRICE_LEVEL_FREE"
  | "PRICE_LEVEL_INEXPENSIVE"
  | "PRICE_LEVEL_MODERATE"
  | "PRICE_LEVEL_EXPENSIVE"
  | "PRICE_LEVEL_VERY_EXPENSIVE";

export type GoogleBusinessStatus =
  | "BUSINESS_STATUS_UNSPECIFIED"
  | "OPERATIONAL"
  | "CLOSED_TEMPORARILY"
  | "CLOSED_PERMANENTLY"
  | "FUTURE_OPENING";

export interface GooglePlace {
  /** Bare place id — the global dedupe key. */
  id?: string;
  /** Resource name, `places/{id}`. */
  name?: string;
  displayName?: GoogleLocalizedText;
  formattedAddress?: string;
  location?: GoogleLatLng;
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: GoogleLocalizedText;
  googleMapsUri?: string;
  businessStatus?: GoogleBusinessStatus;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: GoogleOpeningHours;
  priceLevel?: GooglePriceLevel;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  reviews?: GoogleReview[];
}

export interface GoogleSearchResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
}

export interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

/* ---------------------------------------------------------- geocoding API */

export interface GeocodeResult {
  formatted_address?: string;
  place_id?: string;
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
}

export interface GeocodeResponse {
  status?: string;
  error_message?: string;
  results?: GeocodeResult[];
}
