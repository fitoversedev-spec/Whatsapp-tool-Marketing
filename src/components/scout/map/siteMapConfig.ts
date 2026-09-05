/**
 * Marker colours, transcribed verbatim from `design/site-map.js`.
 *
 * These are literal hex values because they are the map component's *public
 * contract* — `site-map.js` exposes them and the mockups' legends depend on
 * them. They match --green / --blue-bright / --red in the token set; Leaflet
 * icon HTML cannot resolve CSS variables through `divIcon`, so the literals
 * live here, in one place, rather than being scattered through the component.
 */
export const MARKER_COLORS = {
  facility: "#159341",
  demand: "#00aeef",
  plot: "#c81124",
} as const;

export type MarkerType = keyof typeof MARKER_COLORS;

export interface SiteMapMarker {
  lat: number;
  lng: number;
  type?: MarkerType;
  /** Free-form payload handed back to `onMarkerTap`. */
  [key: string]: unknown;
}

/**
 * Colours for user-authored `ScanMarker` annotations — customer locations,
 * competitor areas, and free-form notes dropped directly on the map.
 *
 * Kept separate from {@link MARKER_COLORS}: those mark something *Google*
 * returned (a facility, a demand anchor); these mark something a *person*
 * typed. `SiteMap` renders them with a distinct diamond shape so the two
 * families are never mistaken for one another.
 */
export const CUSTOM_MARKER_COLORS: Record<string, string> = {
  customer: "#8b5cf6",
  competitor: "#f97316",
  custom: "#6b7280",
};

/** A user-placed marker — the map-rendering shape of a `ScanMarker` row. */
export interface CustomSiteMapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  category: string;
}

/** Catchment circle styling from the original custom element. */
export const CIRCLE_STYLE = {
  color: MARKER_COLORS.demand,
  weight: 1.5,
  fillColor: MARKER_COLORS.demand,
  fillOpacity: 0.08,
} as const;

/** Defaults from `site-map.js` — Indiranagar, Bengaluru. */
export const DEFAULTS = {
  lat: 12.9784,
  lng: 77.6408,
  zoom: 14,
  radius: 2,
} as const;

/**
 * Base-layer seam. Phase 4 adds a Google satellite variant for the sweep
 * screen only (DESIGN-ANALYSIS.md §5, Option A). Adding a variant means adding
 * a key here and a case in `resolveBaseLayer`; nothing else in SiteMap changes.
 */
export type BaseLayerId = "osm" | "google-satellite";

export interface BaseLayerSpec {
  url: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom?: number;
  /** Requires a browser Maps key; blocked in Phase 0. */
  requiresKey: boolean;
}

export const BASE_LAYERS: Record<BaseLayerId, BaseLayerSpec> = {
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    requiresKey: false,
  },
  /**
   * Google satellite imagery, for the D3 spaces sweep only.
   *
   * Its `url` is empty here because a Map Tiles API tile URL is not a constant:
   * it carries a **session token**, minted per client from
   * `POST https://tile.googleapis.com/v1/createSession`. Phase 4 mints it
   * server-side in `GET /api/scout/map/satellite` and hands the resolved
   * `BaseLayerSpec` to `<SiteMap tileLayer={…} />`.
   *
   * `requiresKey` stays `true`, so `resolveBaseLayer` still fails closed to OSM
   * for any caller that asks for satellite without supplying a resolved spec —
   * a blank map would be worse than a street map, and a street map that
   * *claims* to be satellite imagery would be worse than both. The sweep screen
   * shows the "satellite imagery unavailable" overlay in that case rather than
   * pretending.
   *
   * Map Tiles API rather than the Maps JavaScript API: it is the documented
   * raster endpoint, it works with the same referrer-restricted browser key,
   * and it keeps one map component instead of two.
   */
  "google-satellite": {
    url: "",
    attribution: "Imagery © Google",
    maxZoom: 21,
    requiresKey: true,
  },
};

export function resolveBaseLayer(id: BaseLayerId): BaseLayerSpec {
  const spec = BASE_LAYERS[id];
  if (spec.requiresKey || spec.url === "") {
    // Fail closed to OSM rather than rendering a blank map.
    return BASE_LAYERS.osm;
  }
  return spec;
}

/** Free Esri World Imagery — fallback when Google satellite key is missing. */
export const ESRI_SATELLITE: BaseLayerSpec = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri",
  maxZoom: 19,
  maxNativeZoom: 17,
  requiresKey: false,
};

/** What `GET /api/scout/map/satellite` answers with. */
export type SatelliteLayerResponse =
  | { readonly available: true; readonly layer: BaseLayerSpec; readonly expiresAt: string | null }
  | { readonly available: false; readonly reason: string };
