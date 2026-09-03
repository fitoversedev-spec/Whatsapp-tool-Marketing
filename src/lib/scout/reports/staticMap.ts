/**
 * The catchment map — Maps Static API.
 *
 * ## Why this degrades to nothing rather than to a placeholder
 *
 * There is no Google key in this environment (`docs/PHASE-4-HANDOFF.md` §11),
 * so `staticMapRequest` answers `null` and the map section is **left out of
 * the document entirely**. Not a grey box, not "map unavailable", not a
 * street-map substitute. A reader who sees a map frame assumes a map was
 * consulted; the surrounding sections make no claim that depends on one, so
 * the honest degradation is silence.
 *
 * ## Why the circle is drawn as a path
 *
 * The Static API has no circle primitive. The radius ring is a 72-point
 * polygon, encoded with Google's polyline algorithm so the URL stays a few
 * hundred characters rather than a few thousand — an unsigned Static Maps URL
 * is capped at 8,192 characters and marker lists eat into the same budget.
 *
 * Pure: no `fetch`, no `process.env`. The key is passed in, and the server-side
 * caller is what turns the URL into an inlined image.
 */

export interface StaticMapPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface StaticMapInput {
  readonly centre: StaticMapPoint;
  readonly radiusM: number;
  readonly facilities: readonly StaticMapPoint[];
  readonly demand: readonly StaticMapPoint[];
  readonly apiKey: string | undefined;
  /** Rendered width in CSS pixels. The API doubles it at `scale=2`. */
  readonly widthPx?: number;
  readonly heightPx?: number;
}

export interface StaticMapRequest {
  readonly url: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Colours match the on-screen map: competition red, demand blue. */
const FACILITY_COLOUR = "0xd7263d";
const DEMAND_COLOUR = "0x00aeef";
const RING_COLOUR = "0x0a0a0a";

const MAX_MARKERS_PER_LAYER = 24;
const RING_POINTS = 72;
/** Static Maps rejects an unsigned request beyond this. Stay well inside it. */
export const STATIC_MAP_URL_LIMIT = 8192;

/** Google's encoded polyline algorithm, for one signed value. */
function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

export function encodePolyline(points: readonly StaticMapPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

/** A closed ring of `RING_POINTS` points at `radiusM` around `centre`. */
export function radiusRing(centre: StaticMapPoint, radiusM: number): StaticMapPoint[] {
  const latDegrees = radiusM / 111_320;
  const cos = Math.cos((centre.lat * Math.PI) / 180);
  const lngDegrees = radiusM / (111_320 * (Math.abs(cos) < 1e-6 ? 1e-6 : cos));

  const ring: StaticMapPoint[] = [];
  for (let i = 0; i <= RING_POINTS; i += 1) {
    const angle = (i / RING_POINTS) * 2 * Math.PI;
    ring.push({
      lat: centre.lat + latDegrees * Math.sin(angle),
      lng: centre.lng + lngDegrees * Math.cos(angle),
    });
  }
  return ring;
}

function markerParam(colour: string, points: readonly StaticMapPoint[]): string | null {
  if (points.length === 0) return null;
  const coords = points
    .slice(0, MAX_MARKERS_PER_LAYER)
    .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join("|");
  return `size:tiny|color:${colour}|${coords}`;
}

/**
 * The request, or `null` when no key is configured.
 *
 * `null` is the whole degradation strategy: the caller drops the section.
 */
export function staticMapRequest(input: StaticMapInput): StaticMapRequest | null {
  if (!input.apiKey) return null;
  if (!Number.isFinite(input.centre.lat) || !Number.isFinite(input.centre.lng)) return null;
  if (!Number.isFinite(input.radiusM) || input.radiusM <= 0) return null;

  const widthPx = input.widthPx ?? 640;
  const heightPx = input.heightPx ?? 380;

  const params = new URLSearchParams();
  params.set("center", `${input.centre.lat.toFixed(6)},${input.centre.lng.toFixed(6)}`);
  params.set("size", `${widthPx}x${heightPx}`);
  // scale=2 so the image is 1280px wide inside a 640px frame — a 96 dpi PDF
  // page renders a scale=1 map visibly soft, and this is the page a reader
  // pinches into on a phone.
  params.set("scale", "2");
  params.set("maptype", "roadmap");
  params.set("format", "png");
  params.set(
    "path",
    `color:${RING_COLOUR}|weight:2|fillcolor:0x00aeef11|enc:${encodePolyline(
      radiusRing(input.centre, input.radiusM),
    )}`,
  );

  const facilityMarkers = markerParam(FACILITY_COLOUR, input.facilities);
  const demandMarkers = markerParam(DEMAND_COLOUR, input.demand);
  if (facilityMarkers) params.append("markers", facilityMarkers);
  if (demandMarkers) params.append("markers", demandMarkers);
  // The plot itself, drawn last so it sits above the rest.
  params.append(
    "markers",
    `size:mid|color:0x0a0a0a|label:S|${input.centre.lat.toFixed(6)},${input.centre.lng.toFixed(6)}`,
  );
  params.set("key", input.apiKey);

  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
  if (url.length > STATIC_MAP_URL_LIMIT) {
    // Rather than silently truncate the evidence, drop the markers and keep
    // the catchment ring — a map showing the wrong subset would be worse.
    const trimmed = new URLSearchParams(params);
    trimmed.delete("markers");
    const fallback = `https://maps.googleapis.com/maps/api/staticmap?${trimmed.toString()}`;
    if (fallback.length > STATIC_MAP_URL_LIMIT) return null;
    return { url: fallback, widthPx, heightPx };
  }

  return { url, widthPx, heightPx };
}

export const STATIC_MAP_LEGEND: readonly string[] = [
  "S — the site under assessment",
  "Red — Google-listed competing facilities",
  "Blue — demand anchors counted in the scan",
];
