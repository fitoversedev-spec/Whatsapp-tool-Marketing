/**
 * Cache layer.
 *
 * Two caches, doing different jobs:
 *
 * - **Place records** (`places`). Saves Place Details calls and keeps one row
 *   per venue shared across every scan. Keyed by `place_id` **and the SKU tier
 *   it was fetched at** — a place cached from a Pro-tier search has no rating
 *   and no reviews, and must not be allowed to satisfy a request that needs
 *   them, or the scan reports zero reviews for half the catchment.
 *
 * - **Search results** (`place_search_cache`). This is the one that makes a
 *   re-scan cheap. A search is billed per call regardless of how many of its
 *   results we already knew, so caching place rows alone saves nothing on a
 *   second scan; remembering *that the search ran* does.
 *
 * ## TTLs are environment configuration, deliberately
 *
 * Google's caching terms are still under the client's legal review
 * (requirement F1). The defaults here are short — a week for place records,
 * three days for review text. When the answer lands, retention is
 * `PLACES_CACHE_TTL_HOURS` and `PLACES_REVIEW_CACHE_TTL_HOURS`, not a rewrite.
 */

import "server-only";

import { createHash } from "node:crypto";

import { Prisma, prisma, type Database } from "@/lib/scout/db";
import type { LatLng } from "@/lib/scout/geo/distance";

import { placesConfig } from "./config";
import { tierSatisfies } from "./fieldMasks";
import type { NormalisedPlace } from "./normalise";
import type { SearchMode, SkuTier } from "./taxonomy";

/**
 * Tile centres are quantised to ~25 m before hashing, so re-scanning the same
 * plot after the pin drifted a few metres still hits the cache. Finer than
 * this and a repeat scan never hits; coarser and tiles start colliding with
 * genuinely different ground.
 */
const CACHE_KEY_PRECISION_DEG = 0.00025;

/**
 * SKU tiers ordered cheapest to richest, for use inside SQL.
 *
 * `GREATEST` on the tier *names* would be wrong — lexicographically `'PRO'`
 * beats `'ENTERPRISE_ATMOSPHERE'`, which would let a cheap search downgrade a
 * fully populated row and silently drop its reviews. Ranking by position in
 * this array is the fix.
 */
const TIER_ORDER_SQL = Prisma.sql`ARRAY['ESSENTIALS','PRO','ENTERPRISE','ENTERPRISE_ATMOSPHERE']::text[]`;

/** A `geography(Point,4326)` literal from a lat/lng pair. */
function pointSql(p: LatLng) {
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng}::double precision, ${p.lat}::double precision), 4326)::geography`;
}

export interface SearchCacheKeyParts {
  readonly centre: LatLng;
  readonly radiusM: number;
  readonly termId: string;
  readonly mode: SearchMode;
  readonly tier: SkuTier;
}

export function searchCacheKey(parts: SearchCacheKeyParts): string {
  const snap = (v: number) => Math.round(v / CACHE_KEY_PRECISION_DEG);
  const raw = [
    snap(parts.centre.lat),
    snap(parts.centre.lng),
    Math.round(parts.radiusM),
    parts.termId,
    parts.mode,
    parts.tier,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export interface CachedSearch {
  readonly googlePlaceIds: string[];
  readonly resultCount: number;
  readonly saturated: boolean;
  /** Billable calls the original search consumed — the saving, when reused. */
  readonly callCount: number;
}

/**
 * Look up a previously executed (tile, term) search.
 *
 * Returns `null` on a miss **and** when any of the place ids it names has
 * fallen out of the place cache or was stored at too low a tier. Serving a
 * partial result would be worse than paying for the call: the count would be
 * quietly wrong.
 */
export async function readSearchCache(
  key: string,
  tier: SkuTier,
  database: Database = prisma,
): Promise<CachedSearch | null> {
  // `tile_centre` is `Unsupported`, so Prisma omits it from the result — which
  // is fine, nothing here reads it back.
  const row = await database.placeSearchCache.findFirst({
    where: { cacheKey: key, cacheExpiresAt: { gt: new Date() } },
  });

  if (!row) return null;
  if (row.googlePlaceIds.length === 0) {
    // A genuinely empty area is a legitimate, reusable answer.
    return { googlePlaceIds: [], resultCount: 0, saturated: row.saturated, callCount: row.callCount };
  }

  const fresh = await readPlaceCache(row.googlePlaceIds, tier, database);
  if (fresh.size !== row.googlePlaceIds.length) return null;

  return {
    googlePlaceIds: row.googlePlaceIds,
    resultCount: row.resultCount,
    saturated: row.saturated,
    callCount: row.callCount,
  };
}

export interface WriteSearchCacheInput extends SearchCacheKeyParts {
  readonly googlePlaceIds: readonly string[];
  readonly saturated: boolean;
  readonly callCount: number;
}

/** Raw: `tile_centre` is a required geography column. */
export async function writeSearchCache(
  input: WriteSearchCacheInput,
  database: Database = prisma,
): Promise<void> {
  const key = searchCacheKey(input);
  const now = new Date();
  const expiresAt = new Date(Date.now() + placesConfig.placeTtlHours * 3_600_000);
  const ids = [...input.googlePlaceIds];

  await database.$executeRaw(Prisma.sql`
    INSERT INTO place_search_cache
      (cache_key, tile_centre, tile_radius_m, term_id, mode, field_tier,
       google_place_ids, result_count, saturated, call_count, cached_at, cache_expires_at)
    VALUES
      (${key}, ${pointSql(input.centre)}, ${Math.round(input.radiusM)}, ${input.termId},
       ${input.mode}, ${input.tier}, ${ids}::text[], ${ids.length}, ${input.saturated},
       ${input.callCount}, ${now}, ${expiresAt})
    ON CONFLICT (cache_key) DO UPDATE SET
      google_place_ids = excluded.google_place_ids,
      result_count = excluded.result_count,
      saturated = excluded.saturated,
      call_count = excluded.call_count,
      cached_at = excluded.cached_at,
      cache_expires_at = excluded.cache_expires_at
  `);
}

export interface CachedPlace {
  /** Our internal uuid, the `scan_places` foreign key. */
  readonly id: string;
  readonly placeId: string;
  readonly location: LatLng;
  readonly name: string;
  readonly rating: number | null;
  readonly reviewCount: number | null;
  readonly fieldTier: SkuTier | null;
}

/**
 * Fresh place rows for `googlePlaceIds`, filtered to those cached at a tier
 * that satisfies `tier`. Ids absent from the returned map are cache misses.
 */
/** Raw: `location` is `Unsupported`, so lat/lng have to be projected out. */
export async function readPlaceCache(
  googlePlaceIds: readonly string[],
  tier: SkuTier,
  database: Database = prisma,
): Promise<Map<string, CachedPlace>> {
  const out = new Map<string, CachedPlace>();
  if (googlePlaceIds.length === 0) return out;

  const rows = await database.$queryRaw<
    Array<{
      id: string;
      placeId: string;
      name: string;
      rating: number | null;
      reviewCount: number | null;
      fieldTier: string | null;
      reviewsCacheExpiresAt: Date | null;
      lat: number;
      lng: number;
    }>
  >(Prisma.sql`
    SELECT id, place_id AS "placeId", name, rating, review_count AS "reviewCount",
           field_tier AS "fieldTier",
           reviews_cache_expires_at AS "reviewsCacheExpiresAt",
           ST_Y(location::geometry) AS lat,
           ST_X(location::geometry) AS lng
    FROM places
    WHERE place_id = ANY(${[...googlePlaceIds]}::text[])
      AND cache_expires_at > ${new Date()}
  `);

  const now = Date.now();
  for (const row of rows) {
    const cachedTier = row.fieldTier as SkuTier | null;
    if (!tierSatisfies(cachedTier, tier)) continue;
    // Review text expires faster than the rest of the record, so a place whose
    // reviews have lapsed is a miss for an Atmosphere-tier request even though
    // the place row itself is still fresh.
    if (tier === "ENTERPRISE_ATMOSPHERE") {
      const reviewsExpire = row.reviewsCacheExpiresAt?.getTime() ?? 0;
      if (reviewsExpire <= now) continue;
    }
    out.set(row.placeId, {
      id: row.id,
      placeId: row.placeId,
      name: row.name,
      rating: row.rating,
      reviewCount: row.reviewCount,
      location: { lat: Number(row.lat), lng: Number(row.lng) },
      fieldTier: cachedTier,
    });
  }
  return out;
}

/**
 * Insert or refresh a place, returning its internal uuid.
 *
 * Never downgrades: a row already cached at Enterprise + Atmosphere keeps its
 * rating, hours and reviews when a cheaper Pro-tier search sees the same venue
 * again. `COALESCE` on each optional column is what enforces that — a Pro
 * search sends `null` for `rating`, and overwriting a real rating with `null`
 * would corrupt the catchment average.
 */
export async function upsertPlaces(
  batch: readonly NormalisedPlace[],
  tier: SkuTier,
  database: Database = prisma,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (batch.length === 0) return out;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + placesConfig.placeTtlHours * 3_600_000);
  const reviewsExpireAt =
    tier === "ENTERPRISE_ATMOSPHERE"
      ? new Date(now.getTime() + placesConfig.reviewTtlHours * 3_600_000)
      : null;

  // Postgres refuses an ON CONFLICT DO UPDATE that would touch the same row
  // twice in one statement, and one tile can legitimately return the same
  // place under two of a term's query strings.
  const unique = new Map<string, NormalisedPlace>();
  for (const place of batch) unique.set(place.placeId, place);

  // Raw: `location` is a required geography column, so Prisma Client cannot
  // insert these rows at all — and `upsert` could not express the COALESCE
  // no-downgrade rule below in any case.
  const values = [...unique.values()].map(
    (place) => Prisma.sql`(
      ${place.placeId}, ${place.name}, ${pointSql(place.location)},
      ${place.rating}::real, ${place.reviewCount}::int, ${place.address},
      ${place.hours ? JSON.stringify(place.hours) : null}::jsonb,
      ${place.hours ? JSON.stringify(place.operatingWindow) : null}::jsonb,
      ${place.priceLevel}::smallint, ${place.website}, ${place.phone},
      ${place.googleTypes ?? null}::text[], ${place.primaryType},
      ${place.primaryTypeDisplayName}, ${place.googleMapsUri}, ${place.businessStatus},
      ${tier}, ${now}, ${expiresAt}, ${reviewsExpireAt ? now : null}::timestamptz,
      ${reviewsExpireAt}::timestamptz, ${now}
    )`,
  );

  const rows = await database.$queryRaw<Array<{ id: string; placeId: string }>>(Prisma.sql`
    INSERT INTO places
      (place_id, name, location, rating, review_count, address, hours,
       operating_window, price_level, website, phone, google_types, primary_type,
       primary_type_display_name, google_maps_uri, business_status, field_tier,
       cached_at, cache_expires_at, reviews_cached_at, reviews_cache_expires_at, updated_at)
    VALUES ${Prisma.join(values, ", ")}
    ON CONFLICT (place_id) DO UPDATE SET
      name = excluded.name,
      location = excluded.location,
      address = COALESCE(excluded.address, places.address),
      rating = COALESCE(excluded.rating, places.rating),
      review_count = COALESCE(excluded.review_count, places.review_count),
      hours = COALESCE(excluded.hours, places.hours),
      operating_window = COALESCE(excluded.operating_window, places.operating_window),
      price_level = COALESCE(excluded.price_level, places.price_level),
      website = COALESCE(excluded.website, places.website),
      phone = COALESCE(excluded.phone, places.phone),
      google_types = COALESCE(excluded.google_types, places.google_types),
      primary_type = COALESCE(excluded.primary_type, places.primary_type),
      primary_type_display_name =
        COALESCE(excluded.primary_type_display_name, places.primary_type_display_name),
      google_maps_uri = COALESCE(excluded.google_maps_uri, places.google_maps_uri),
      business_status = COALESCE(excluded.business_status, places.business_status),
      -- Keep the richest tier this row has ever been fetched at.
      field_tier = CASE WHEN array_position(${TIER_ORDER_SQL}, excluded.field_tier)
                             >= COALESCE(array_position(${TIER_ORDER_SQL}, places.field_tier), 0)
                        THEN excluded.field_tier ELSE places.field_tier END,
      cached_at = excluded.cached_at,
      cache_expires_at = GREATEST(excluded.cache_expires_at, places.cache_expires_at),
      reviews_cached_at = COALESCE(excluded.reviews_cached_at, places.reviews_cached_at),
      reviews_cache_expires_at =
        GREATEST(excluded.reviews_cache_expires_at, places.reviews_cache_expires_at),
      updated_at = excluded.updated_at
    RETURNING id, place_id AS "placeId"
  `);

  for (const row of rows) out.set(row.placeId, row.id);
  return out;
}

/**
 * Persist review rows for a whole tile's worth of places in one statement.
 *
 * Reviews without a Google resource name cannot be deduped across refreshes,
 * so they are dropped rather than duplicated on every re-scan.
 */
export async function upsertReviews(
  entries: ReadonlyArray<{ placeUuid: string; reviews: NormalisedPlace["reviews"] }>,
  database: Database = prisma,
): Promise<number> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + placesConfig.reviewTtlHours * 3_600_000);

  // Deduped on the Google review id for the same reason places are: one
  // statement may not update the same conflicting row twice.
  const unique = new Map<string, { placeUuid: string; review: NormalisedPlace["reviews"][number] }>();
  for (const entry of entries) {
    for (const review of entry.reviews) {
      if (review.googleReviewId) {
        unique.set(review.googleReviewId, { placeUuid: entry.placeUuid, review });
      }
    }
  }
  if (unique.size === 0) return 0;

  // Raw for the ON CONFLICT: Prisma's `upsert` is single-row, and this runs once
  // per tile with up to five reviews for each of twenty places.
  const values = [...unique.values()].map(
    ({ placeUuid, review: r }) => Prisma.sql`(
      ${placeUuid}::uuid, ${r.googleReviewId}, ${r.authorName}, ${r.rating}::smallint,
      ${r.text}, ${r.languageCode}, ${r.publishedAt}::timestamptz, ${now}, ${expiresAt}
    )`,
  );

  await database.$executeRaw(Prisma.sql`
    INSERT INTO place_reviews
      (place_id, google_review_id, author_name, rating, text, language_code,
       published_at, cached_at, cache_expires_at)
    VALUES ${Prisma.join(values, ", ")}
    ON CONFLICT (google_review_id) DO UPDATE SET
      rating = excluded.rating,
      text = excluded.text,
      cached_at = excluded.cached_at,
      cache_expires_at = excluded.cache_expires_at
  `);

  return unique.size;
}

/**
 * Delete everything past its TTL.
 *
 * Expiry alone stops stale data being *served*; this stops it being *retained*,
 * which is the part Google's caching terms care about. Wire it to a cron once
 * requirement F1 is answered.
 */
export async function purgeExpiredCache(
  database: Database = prisma,
): Promise<{ places: number; searches: number }> {
  const now = new Date();
  const searches = await database.placeSearchCache.deleteMany({
    where: { cacheExpiresAt: { lt: now } },
  });
  const placeRows = await database.place.deleteMany({
    where: { cacheExpiresAt: { lt: now } },
  });
  return { places: placeRows.count, searches: searches.count };
}
