"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/scout/ui";
import { SiteMap } from "@/components/scout/map";

interface ClickedPoint {
  lat: number;
  lng: number;
  address: string | null;
  loading: boolean;
}

export function FindSpacesScreen() {
  const [point, setPoint] = useState<ClickedPoint | null>(null);
  const [scanning, setScanning] = useState(false);

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setPoint({ lat, lng, address: null, loading: true });
    try {
      const res = await fetch(`/api/scout/geocode?lat=${lat}&lng=${lng}`);
      const data = await res.json();
      const addr = data.results?.[0]?.formattedAddress ?? null;
      setPoint({ lat, lng, address: addr, loading: false });
    } catch {
      setPoint({ lat, lng, address: null, loading: false });
    }
  }, []);

  const handleMapClick = useCallback(
    (e: { lat: number; lng: number }) => {
      void reverseGeocode(e.lat, e.lng);
    },
    [reverseGeocode],
  );

  function startQuickScan() {
    if (!point) return;
    setScanning(true);
    const params = new URLSearchParams({
      lat: point.lat.toFixed(6),
      lng: point.lng.toFixed(6),
    });
    if (point.address) params.set("address", point.address);
    window.location.href = `/scout/scan?${params.toString()}`;
  }

  function openGoogleMaps() {
    if (!point) return;
    window.open(
      `https://www.google.com/maps/@${point.lat},${point.lng},18z`,
      "_blank",
    );
  }

  function openStreetView() {
    if (!point) return;
    window.open(
      `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat},${point.lng}`,
      "_blank",
    );
  }

  function clearPoint() {
    setPoint(null);
  }

  const markers = point
    ? [
        {
          id: "selected",
          lat: point.lat,
          lng: point.lng,
          category: "customer",
          label: point.address ?? "Selected point",
        },
      ]
    : [];

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Map area */}
      <div className="flex-1 relative">
        <SiteMap
          lat={12.97}
          lng={77.59}
          radius={5}
          interactive
          scrollWheelZoom
          showRadius={false}
          showPin={false}
          fitToRadius={false}
          customMarkers={markers}
          onMapRightClick={handleMapClick}
        />

        {/* Instructions overlay */}
        {!point && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur-sm rounded-xl shadow-lg px-5 py-3 text-sm text-slate-700 pointer-events-none">
            <span className="font-semibold">Right-click</span> anywhere on the map to explore an area
          </div>
        )}
      </div>

      {/* Side panel */}
      <div className="w-[380px] flex-none border-l border-slate-200 bg-white flex flex-col overflow-y-auto max-[900px]:hidden">
        {point ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900 m-0">
                Selected location
              </h2>
              <button
                type="button"
                onClick={clearPoint}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                title="Clear selection"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Address */}
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                Address
              </p>
              {point.loading ? (
                <p className="text-sm text-slate-400 animate-pulse">
                  Looking up address...
                </p>
              ) : point.address ? (
                <p className="text-sm text-slate-900 leading-relaxed">
                  {point.address}
                </p>
              ) : (
                <p className="text-sm text-slate-400">
                  No address found for this location
                </p>
              )}
            </div>

            {/* Coordinates */}
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                Coordinates
              </p>
              <p className="text-sm text-slate-700 font-mono tabular-nums">
                {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
              </p>
            </div>

            {/* External links */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openGoogleMaps}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg py-2.5 px-3 transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Satellite
              </button>
              <button
                type="button"
                onClick={openStreetView}
                className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg py-2.5 px-3 transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                  <path d="M2 12h20" />
                </svg>
                Street View
              </button>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                Interested in this area? Run a quick scan to see nearby sports
                facilities, demand anchors, and competition.
              </p>
              <Button block onClick={startQuickScan} disabled={scanning}>
                {scanning ? "Opening scan..." : "Scan this area"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Explore the map
            </h3>
            <p className="text-sm text-slate-500 leading-relaxed max-w-[260px]">
              Right-click any point to get the address and surrounding details.
              If the location looks promising, scan it to check nearby facilities.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
