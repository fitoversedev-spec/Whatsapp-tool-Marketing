import "server-only";

import { env } from "@/lib/scout/env";

import { STATIC_MAP_ATTRIBUTION } from "./brand";
import { STATIC_MAP_LEGEND, staticMapRequest } from "./staticMap";
import type { MapSection } from "./types";

/**
 * Fetch the catchment map and inline it into the document.
 *
 * ## Why the image is inlined rather than linked
 *
 * A `<img src="https://maps.googleapis.com/…&key=…">` would put the API key in
 * the HTML. The PDF itself would be fine — the raster is baked in — but the
 * same HTML is served as a preview, and a key in a preview is a key in a
 * customer's browser. Fetching server-side and embedding a data URI keeps the
 * key on the server, makes the render deterministic, and means the finished
 * PDF has no external dependency at all.
 *
 * ## Why a failure omits the section rather than showing a broken frame
 *
 * There is **no Google key in this environment**, so this returns `null` today
 * and the map section is dropped from the document. Same for a rate limit, a
 * billing failure or a timeout. A grey rectangle captioned "map unavailable"
 * tells a reader a map was consulted and something went wrong with the
 * printing; the truth is that no map was consulted, and the rest of the report
 * makes no claim that rests on one.
 */

export interface StaticMapFetchInput {
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly radiusM: number;
  readonly areaLabel: string;
  readonly facilities: ReadonlyArray<{ readonly lat: number; readonly lng: number }>;
  readonly demand: ReadonlyArray<{ readonly lat: number; readonly lng: number }>;
}

/** A map image past this is not worth the bytes in a document capped at 5 MB. */
const MAX_MAP_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 8_000;

export async function fetchStaticMap(input: StaticMapFetchInput): Promise<MapSection | null> {
  const request = staticMapRequest({
    centre: input.centre,
    radiusM: input.radiusM,
    facilities: input.facilities,
    demand: input.demand,
    // The Static Maps API is billed against the browser key's product set. It
    // is called from the server here, so the *server* key is the correct one
    // to use — a referrer-restricted key would be rejected outright.
    apiKey: env.googleMapsServerKey,
  });
  if (!request) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, { signal: controller.signal });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_MAP_BYTES) return null;

    return {
      url: `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`,
      alt: `Map of the ${(input.radiusM / 1000).toFixed(1)} km catchment around ${input.areaLabel}, with competing facilities and demand anchors marked.`,
      attribution: STATIC_MAP_ATTRIBUTION,
      legend: [...STATIC_MAP_LEGEND],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
