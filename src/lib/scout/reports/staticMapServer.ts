import "server-only";

import sharp from "sharp";

import { env } from "@/lib/scout/env";

import { STATIC_MAP_ATTRIBUTION } from "./brand";
import { computeMapZoom, latLngToPixel, markerLabel, STATIC_MAP_LEGEND, staticMapRequest } from "./staticMap";
import type { CategoryMapSection, MapSection } from "./types";

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

export interface CategoryMapInput {
  readonly categoryId: string;
  readonly label: string;
  readonly side: "competition" | "demand";
  readonly locations: ReadonlyArray<{ readonly lat: number; readonly lng: number }>;
}

const MAP_SCALE = 2;
const LABEL_OFFSET = 55;
const FONT_SIZE = 12;
const BOX_PAD = 4;

function buildCalloutSvg(
  locations: ReadonlyArray<{ readonly lat: number; readonly lng: number }>,
  centre: { readonly lat: number; readonly lng: number },
  zoom: number,
  cssWidth: number,
  cssHeight: number,
  color: string,
): string {
  const imgW = cssWidth * MAP_SCALE;
  const imgH = cssHeight * MAP_SCALE;
  const fs = FONT_SIZE * MAP_SCALE;
  const pad = BOX_PAD * MAP_SCALE;
  const offset = LABEL_OFFSET * MAP_SCALE;
  const boxH = fs + pad * 2;
  const boxW = fs + pad * 4;

  let els = "";
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const { x: px, y: py } = latLngToPixel(loc, centre, zoom, imgW, imgH);
    const dx = px - imgW / 2;
    const dy = py - imgH / 2;
    const angle = Math.atan2(dy, dx);
    const dist = Math.sqrt(dx * dx + dy * dy);
    let lx = imgW / 2 + Math.cos(angle) * (dist + offset);
    let ly = imgH / 2 + Math.sin(angle) * (dist + offset);
    const margin = 30 * MAP_SCALE;
    lx = Math.max(margin, Math.min(imgW - margin, lx));
    ly = Math.max(margin, Math.min(imgH - margin, ly));

    const label = markerLabel(i);
    els += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${color}" stroke-width="${1.5 * MAP_SCALE}" opacity="0.8"/>`;
    els += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${4 * MAP_SCALE}" fill="${color}"/>`;
    els += `<rect x="${(lx - boxW / 2).toFixed(1)}" y="${(ly - boxH / 2).toFixed(1)}" width="${boxW}" height="${boxH}" rx="${3 * MAP_SCALE}" fill="white" stroke="${color}" stroke-width="${1.5 * MAP_SCALE}"/>`;
    els += `<text x="${lx.toFixed(1)}" y="${(ly + fs * 0.35).toFixed(1)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="bold" fill="${color}">${label}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">${els}</svg>`;
}

async function annotateMapImage(
  buffer: Buffer,
  locations: ReadonlyArray<{ readonly lat: number; readonly lng: number }>,
  centre: { readonly lat: number; readonly lng: number },
  zoom: number,
  cssWidth: number,
  cssHeight: number,
  color: string,
): Promise<Buffer> {
  const svg = buildCalloutSvg(locations, centre, zoom, cssWidth, cssHeight, color);
  return sharp(buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

export async function fetchCategoryMaps(
  centre: { readonly lat: number; readonly lng: number },
  radiusM: number,
  areaLabel: string,
  categories: readonly CategoryMapInput[],
): Promise<CategoryMapSection[]> {
  const cssWidth = 640;
  const cssHeight = 380;
  const zoom = computeMapZoom(centre, radiusM, cssWidth, cssHeight);

  const results = await Promise.all(
    categories
      .filter((c) => c.locations.length > 0)
      .map(async (c): Promise<CategoryMapSection | null> => {
        const request = staticMapRequest({
          centre,
          radiusM,
          facilities: c.side === "competition" ? c.locations : [],
          demand: c.side === "demand" ? c.locations : [],
          apiKey: env.googleMapsServerKey,
          zoom,
        });
        if (!request) return null;

        const color = c.side === "competition" ? "#159341" : "#0066BB";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const response = await fetch(request.url, { signal: controller.signal });
          if (!response.ok) return null;
          const contentType = response.headers.get("content-type") ?? "";
          if (!contentType.startsWith("image/")) return null;
          let buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.byteLength === 0 || buffer.byteLength > MAX_MAP_BYTES) return null;

          try {
            buffer = await annotateMapImage(buffer, c.locations, centre, zoom, cssWidth, cssHeight, color) as Buffer<ArrayBuffer>;
          } catch { /* fall back to unannotated image */ }

          return {
            categoryId: c.categoryId,
            label: c.label,
            side: c.side,
            url: `data:image/png;base64,${buffer.toString("base64")}`,
            alt: `Map showing ${c.label} within ${(radiusM / 1000).toFixed(1)} km of ${areaLabel}.`,
            attribution: STATIC_MAP_ATTRIBUTION,
            placeCount: c.locations.length,
          };
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      }),
  );
  return results.filter((r): r is CategoryMapSection => r !== null);
}
