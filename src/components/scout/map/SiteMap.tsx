"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type * as LeafletNS from "leaflet";
import {
  CIRCLE_STYLE,
  DEFAULTS,
  MARKER_COLORS,
  resolveBaseLayer,
  type BaseLayerId,
  type BaseLayerSpec,
  type SiteMapMarker,
} from "./siteMapConfig";


export interface SiteMapProps {
  lat?: number;
  lng?: number;
  zoom?: number;
  /** Catchment radius in **kilometres**, matching the original attribute. */
  radius?: number;
  markers?: SiteMapMarker[];
  /** Enables dragging, double-click zoom, touch zoom and tap. */
  interactive?: boolean;
  /** `"drag"` makes the centre pin draggable; anything else leaves it fixed. */
  pin?: "drag" | "fixed";
  /** Replaces the `pinmove` CustomEvent. */
  onPinMove?: (position: { lat: number; lng: number }) => void;
  /** Replaces the `markertap` CustomEvent. */
  onMarkerTap?: (marker: SiteMapMarker) => void;
  /** Seam for the Phase 4 Google satellite variant on the sweep screen. */
  baseLayer?: BaseLayerId;
  /**
   * A fully resolved tile layer, overriding `baseLayer`.
   *
   * The satellite variant's URL carries a per-client session token, so it
   * cannot be a constant in `BASE_LAYERS` — the sweep screen fetches it and
   * passes it here. Swapping this at runtime swaps the tiles in place without
   * rebuilding the map.
   */
  tileLayer?: BaseLayerSpec | null;
  /** `false` leaves the viewport alone — the sweep screen pans and zooms freely. */
  fitToRadius?: boolean;
  /** `false` hides the catchment circle. */
  showRadius?: boolean;
  /** `false` hides the centre pin. */
  showPin?: boolean;
  scrollWheelZoom?: boolean;
  zoomControl?: boolean;
  /**
   * Handed the live Leaflet map once it exists, for callers that need to draw
   * their own overlay on it — the sweep grid is projected from the map's own
   * container points, so it stays glued to the ground as the map moves.
   */
  onReady?: (map: LeafletNS.Map) => void;
  className?: string;
  style?: CSSProperties;
  /** Accessible name for the map region. */
  ariaLabel?: string;
}

type Leaflet = typeof LeafletNS;

function dotIcon(L: Leaflet, type: SiteMapMarker["type"]): LeafletNS.DivIcon {
  const c = MARKER_COLORS[type ?? "facility"] ?? MARKER_COLORS.facility;
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html:
      '<span style="display:block;width:14px;height:14px;border-radius:50%;background:' +
      c +
      ';box-shadow:0 0 0 2.5px #fff,0 1px 3px rgba(0,0,0,.35)"></span>',
  });
}

function pinIcon(L: Leaflet): LeafletNS.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [26, 34],
    iconAnchor: [13, 32],
    html:
      '<svg width="26" height="34" viewBox="0 0 26 34" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M13 33C13 33 24 21.6 24 13A11 11 0 1 0 2 13c0 8.6 11 20 11 20z" fill="' +
      MARKER_COLORS.plot +
      '" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="13" cy="13" r="4" fill="#fff"/></svg>',
  });
}

/**
 * React port of `design/site-map.js`, preserving its public contract.
 *
 * Behaviour kept deliberately: the IntersectionObserver deferred mount, the
 * 120ms/600ms `invalidateSize` pair and the debounced ResizeObserver. Leaflet
 * measures its container during `L.map()`, and inside a flex column that
 * container is frequently still 0px high at that moment — without these the
 * map renders as a grey box or with the tiles offset. Do not remove them.
 */
export function SiteMap({
  lat = DEFAULTS.lat,
  lng = DEFAULTS.lng,
  zoom = DEFAULTS.zoom,
  radius = DEFAULTS.radius,
  markers,
  interactive = false,
  pin = "fixed",
  onPinMove,
  onMarkerTap,
  baseLayer = "osm",
  tileLayer = null,
  fitToRadius = true,
  showRadius = true,
  showPin = true,
  scrollWheelZoom = false,
  zoomControl = false,
  onReady,
  className,
  style,
  ariaLabel = "Map of the scan area",
}: SiteMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const circleRef = useRef<LeafletNS.Circle | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const pinRef = useRef<LeafletNS.Marker | null>(null);
  const tileRef = useRef<LeafletNS.TileLayer | null>(null);
  const leafletRef = useRef<Leaflet | null>(null);

  // Callbacks are read through refs so changing a handler never rebuilds the map.
  const onPinMoveRef = useRef(onPinMove);
  const onMarkerTapRef = useRef(onMarkerTap);
  const onReadyRef = useRef(onReady);
  onPinMoveRef.current = onPinMove;
  onMarkerTapRef.current = onMarkerTap;
  onReadyRef.current = onReady;

  // Latest geometry, read by the deferred build without re-triggering it.
  const geometryRef = useRef({
    lat,
    lng,
    zoom,
    radius,
    interactive,
    pin,
    baseLayer,
    tileLayer,
    fitToRadius,
    showRadius,
    showPin,
    scrollWheelZoom,
    zoomControl,
  });
  geometryRef.current = {
    lat,
    lng,
    zoom,
    radius,
    interactive,
    pin,
    baseLayer,
    tileLayer,
    fitToRadius,
    showRadius,
    showPin,
    scrollWheelZoom,
    zoomControl,
  };

  const markersRef = useRef<SiteMapMarker[]>(markers ?? []);
  markersRef.current = markers ?? [];

  /* ---------- build (deferred until visible, as in the original) ---------- */
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let cancelled = false;
    let io: IntersectionObserver | null = null;
    let ro: ResizeObserver | null = null;
    let started = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let resizeDebounce: ReturnType<typeof setTimeout> | undefined;

    function fit() {
      const map = mapRef.current;
      const circle = circleRef.current;
      // The sweep screen sets `fitToRadius={false}`: it pans and zooms freely,
      // and snapping the viewport back to a circle would undo every pan.
      if (!map || !circle || !geometryRef.current.fitToRadius) return;
      map.fitBounds(circle.getBounds().pad(0.08), { animate: false });
    }

    function paintMarkers(L: Leaflet) {
      const layer = layerRef.current;
      if (!layer) return;
      layer.clearLayers();
      for (const m of markersRef.current) {
        L.marker([m.lat, m.lng], { icon: dotIcon(L, m.type) })
          .addTo(layer)
          .on("click", () => onMarkerTapRef.current?.(m));
      }
    }

    async function build() {
      if (started || cancelled) return;
      started = true;

      // Leaflet touches `window` at import time — load it only in the browser.
      const mod = await import("leaflet");
      if (cancelled || !canvasRef.current) return;

      const L = (mod.default ?? mod) as unknown as Leaflet;
      leafletRef.current = L;
      const g = geometryRef.current;
      const layerSpec = g.tileLayer ?? resolveBaseLayer(g.baseLayer);

      const map = L.map(canvasRef.current, {
        center: [g.lat, g.lng],
        zoom: g.zoom,
        zoomControl: g.zoomControl,
        attributionControl: true,
        dragging: g.interactive,
        scrollWheelZoom: g.scrollWheelZoom,
        doubleClickZoom: g.interactive,
        touchZoom: g.interactive,
        boxZoom: false,
        keyboard: false,
      });
      mapRef.current = map;

      tileRef.current = L.tileLayer(layerSpec.url, {
        attribution: layerSpec.attribution,
        maxZoom: layerSpec.maxZoom,
      }).addTo(map);
      map.attributionControl.setPrefix("");

      circleRef.current = L.circle([g.lat, g.lng], {
        radius: g.radius * 1000,
        ...CIRCLE_STYLE,
        opacity: g.showRadius ? 1 : 0,
        fillOpacity: g.showRadius ? CIRCLE_STYLE.fillOpacity : 0,
        interactive: false,
      }).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);
      paintMarkers(L);

      // The sweep screen draws no centre pin: its subject is the grid, and a
      // marker in the middle of it would sit on top of a clickable cell.
      if (g.showPin) {
        const marker = L.marker([g.lat, g.lng], {
          icon: pinIcon(L),
          draggable: g.pin === "drag",
          keyboard: false,
        }).addTo(map);
        pinRef.current = marker;

        marker.on("drag", (e) => {
          const p = (e.target as LeafletNS.Marker).getLatLng();
          circleRef.current?.setLatLng(p);
        });
        marker.on("dragend", (e) => {
          const p = (e.target as LeafletNS.Marker).getLatLng();
          onPinMoveRef.current?.({ lat: p.lat, lng: p.lng });
        });
      }

      if (g.pin === "drag" && g.showPin) {
        map.on("click", (e: LeafletNS.LeafletMouseEvent) => {
          pinRef.current?.setLatLng(e.latlng);
          circleRef.current?.setLatLng(e.latlng);
          onPinMoveRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
      }

      fit();
      onReadyRef.current?.(map);
      // Leaflet mis-measures inside flex containers; re-measure twice.
      timers.push(setTimeout(() => mapRef.current?.invalidateSize(), 120));
      timers.push(
        setTimeout(() => {
          mapRef.current?.invalidateSize();
          fit();
        }, 600),
      );

      if (typeof ResizeObserver !== "undefined" && hostRef.current) {
        ro = new ResizeObserver(() => {
          clearTimeout(resizeDebounce);
          resizeDebounce = setTimeout(() => {
            mapRef.current?.invalidateSize();
            fit();
          }, 250);
        });
        ro.observe(hostRef.current);
      }
    }

    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            io = null;
            void build();
          }
        },
        { rootMargin: "150px" },
      );
      io.observe(host);
      // Safety net for containers the observer never reports (0-height flex kids).
      timers.push(
        setTimeout(() => {
          if (!started && host.isConnected && host.getBoundingClientRect().height > 0) {
            void build();
          }
        }, 1200),
      );
    } else {
      void build();
    }

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      clearTimeout(resizeDebounce);
      io?.disconnect();
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      circleRef.current = null;
      layerRef.current = null;
      pinRef.current = null;
      tileRef.current = null;
    };
    // Built once, with an empty dependency list on purpose: prop changes are
    // applied by the effects below, mirroring the original custom element's
    // attributeChangedCallback. Rebuilding the Leaflet map on every prop change
    // would tear down and re-request every tile.
  }, []);

  /* ---------- attributeChangedCallback equivalents ---------- */

  useEffect(() => {
    const map = mapRef.current;
    const circle = circleRef.current;
    if (!map || !circle) return;
    circle.setLatLng([lat, lng]);
    pinRef.current?.setLatLng([lat, lng]);
    if (fitToRadius) map.fitBounds(circle.getBounds().pad(0.08), { animate: false });
    else map.setView([lat, lng], map.getZoom(), { animate: false });
  }, [lat, lng, fitToRadius]);

  useEffect(() => {
    const map = mapRef.current;
    const circle = circleRef.current;
    if (!map || !circle) return;
    circle.setRadius(radius * 1000);
    if (fitToRadius) map.fitBounds(circle.getBounds().pad(0.08), { animate: false });
  }, [radius, fitToRadius]);

  /**
   * Swap the tiles in place when a resolved layer arrives.
   *
   * The satellite spec is fetched after the map has already mounted — its URL
   * carries a session token minted server-side. Rebuilding the map to apply it
   * would flash the whole screen and re-request every tile of the old layer
   * first; adding the new layer and removing the old one does not.
   */
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    const spec = tileLayer ?? resolveBaseLayer(baseLayer);
    const previous = tileRef.current;
    const next = L.tileLayer(spec.url, {
      attribution: spec.attribution,
      maxZoom: spec.maxZoom,
    }).addTo(map);
    tileRef.current = next;
    if (previous) map.removeLayer(previous);
  }, [tileLayer, baseLayer]);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const m of markersRef.current) {
      L.marker([m.lat, m.lng], { icon: dotIcon(L, m.type) })
        .addTo(layer)
        .on("click", () => onMarkerTapRef.current?.(m));
    }
  }, [markers]);

  useEffect(() => {
    const dragging = pinRef.current?.dragging;
    if (!dragging) return;
    if (pin === "drag") dragging.enable();
    else dragging.disable();
  }, [pin]);

  return (
    <div
      ref={hostRef}
      className={["block relative overflow-hidden bg-[var(--map-placeholder)] w-full h-full", className].filter(Boolean).join(" ")}
      style={style}
      role="region"
      aria-label={ariaLabel}
    >
      <div ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
