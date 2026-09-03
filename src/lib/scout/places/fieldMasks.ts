/**
 * Field masks for Places API (New).
 *
 * ⚠️ **V3.** A wrong field name here fails at *request* time with a 400, not at
 * compile time, and it fails on every call — so this is the single most
 * expensive thing in Phase 1 to get wrong. Every path below was taken from the
 * live Place resource reference on 18 Aug 2026 and is listed in
 * `docs/PHASE-1-UNVERIFIED.md` → V3 with the one-command test to run once a
 * key exists.
 *
 * Two rules the API enforces and this file encodes:
 *
 * 1. **Search masks are prefixed `places.`; Place Details masks are not.**
 *    `places.displayName` on a details call is rejected, and vice versa.
 * 2. **The mask decides the price.** Google bills the request at the highest
 *    SKU tier any requested field belongs to. Asking for `rating` promotes a
 *    Pro call to Enterprise; asking for `reviews` promotes it to Enterprise +
 *    Atmosphere. So the tiers below are cumulative on purpose, and
 *    `skuTierForFields` is the inverse function used by the cost meter.
 */

import type { SkuTier } from "./taxonomy";

/**
 * Identity and geometry. Everything the pipeline needs to dedupe a place and
 * decide whether it is inside the catchment.
 *
 * `id`, `location`, `formattedAddress` and `types` are Essentials-tier fields;
 * `displayName`, `primaryType`, `googleMapsUri` and `businessStatus` are Pro.
 * We always want a name, so the cheapest search we ever issue is Pro.
 */
const PRO_FIELDS = [
  "id",
  "displayName",
  "location",
  "formattedAddress",
  "types",
  "primaryType",
  "primaryTypeDisplayName",
  "googleMapsUri",
  "businessStatus",
] as const;

/**
 * Rating, review count, hours, contact and price level. Score components 2–4
 * are built from these, and the operating window is derived from
 * `regularOpeningHours`.
 */
const ENTERPRISE_FIELDS = [
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "priceLevel",
  "websiteUri",
  "nationalPhoneNumber",
] as const;

/** Review text. Ingested here, analysed by Phase 3. */
const ATMOSPHERE_FIELDS = ["reviews"] as const;

const TIER_FIELDS: Record<SkuTier, readonly string[]> = {
  ESSENTIALS: ["id", "location", "formattedAddress", "types"],
  PRO: PRO_FIELDS,
  ENTERPRISE: [...PRO_FIELDS, ...ENTERPRISE_FIELDS],
  ENTERPRISE_ATMOSPHERE: [...PRO_FIELDS, ...ENTERPRISE_FIELDS, ...ATMOSPHERE_FIELDS],
};

/** Bare field names for a given tier, in a stable order. */
export function fieldsForTier(tier: SkuTier): readonly string[] {
  return TIER_FIELDS[tier];
}

/**
 * `X-Goog-FieldMask` for `places:searchNearby` / `places:searchText`.
 * `nextPageToken` is free to request and is what makes Text Search pagination
 * possible at all.
 */
export function searchFieldMask(tier: SkuTier, includePageToken = false): string {
  const paths = TIER_FIELDS[tier].map((f) => `places.${f}`);
  if (includePageToken) paths.push("nextPageToken");
  return paths.join(",");
}

/** `X-Goog-FieldMask` for `GET /v1/places/{placeId}` — no `places.` prefix. */
export function detailsFieldMask(tier: SkuTier): string {
  return TIER_FIELDS[tier].join(",");
}

/**
 * Which SKU tier a set of bare field names will be billed at.
 *
 * The inverse of {@link fieldsForTier}, and the reason the cost meter cannot
 * drift from what was actually requested: the meter passes the mask it sent,
 * not a tier a caller remembered to declare.
 */
export function skuTierForFields(fields: readonly string[]): SkuTier {
  const bare = new Set(fields.map((f) => f.replace(/^places\./, "")));
  if (ATMOSPHERE_FIELDS.some((f) => bare.has(f))) return "ENTERPRISE_ATMOSPHERE";
  if (ENTERPRISE_FIELDS.some((f) => bare.has(f))) return "ENTERPRISE";
  if (PRO_FIELDS.some((f) => bare.has(f) && !TIER_FIELDS.ESSENTIALS.includes(f))) return "PRO";
  return "ESSENTIALS";
}

/**
 * Stable cache key for a field set.
 *
 * A place cached from a Pro-tier search has no reviews and no opening hours. It
 * must not satisfy a later request that needs them, or the scan silently
 * reports zero reviews for half the catchment. Storing the tier a row was
 * fetched at is what makes that check possible.
 */
export function fieldSetKey(tier: SkuTier): string {
  return tier;
}

/** True when a row cached at `cached` covers everything `wanted` needs. */
export function tierSatisfies(cached: SkuTier | null | undefined, wanted: SkuTier): boolean {
  if (!cached) return false;
  const rank: Record<SkuTier, number> = {
    ESSENTIALS: 0,
    PRO: 1,
    ENTERPRISE: 2,
    ENTERPRISE_ATMOSPHERE: 3,
  };
  return rank[cached] >= rank[wanted];
}
