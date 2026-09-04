"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteMap } from "@/components/scout/map";
import {
  FieldHeader,
  StickyFooter,
  apiFetch,
  ApiError,
  useDebounced,
  useGeolocation,
  useOnline,
} from "@/components/scout/mobile";
import { SectionLabel } from "@/components/scout/patterns";
import { Button, Tag } from "@/components/scout/ui";

/** `publicTaxonomy()`'s shape — labels and presets only, never search strings. */
export interface PublicTaxonomy {
  readonly categories: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly side: "competition" | "demand";
    readonly termCount: number;
  }>;
  readonly presets: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly categoryIds: readonly string[];
  }>;
}

interface EstimateResponse {
  readonly tiles: number;
  readonly terms: number;
  readonly minCalls: number;
  readonly maxCalls: number;
  readonly minCostUsd: number;
  readonly maxCostUsd: number;
  readonly durationLabel: string;
  readonly exceedsTileLimit: boolean;
}

/** The four the mockup draws, in kilometres. */
const RADII_KM = [1, 2, 3, 5] as const;

const STORAGE_KEY = "sitescout.field.lastPlan";

interface StoredPlan {
  lat: number;
  lng: number;
  address: string;
  radiusKm: number;
  categoryIds: string[];
}

/**
 * Screen 01 — Site check.
 *
 * The one job of this screen is to put a pin on a plot and start a scan, and
 * everything on it exists to make that possible while standing outdoors on one
 * bar of signal.
 *
 * ## The addition the mockup does not have
 *
 * **"Use my current location."** The mockup's flow is to type an address, which
 * is the desktop interaction transplanted. The person using this is standing on
 * the plot. So the primary way to set the centre is one tap, and the address
 * field becomes the fallback rather than the entry point. Permission is
 * requested on that tap and never on load — an unprompted permission dialog is
 * the fastest route to a permanent block, and a permanent block would kill the
 * most useful control on the screen for good.
 *
 * ## Why the scan is not awaited
 *
 * `POST /api/scout/scans` plans the work and returns a `202` in milliseconds; the
 * tiles are processed by a background worker. So this screen navigates to the
 * results screen immediately and lets that one watch progress. A scan that dies
 * at tile 6 of 8 on bad signal resumes from tile 6, because the completed work
 * is rows in the database rather than state in this browser.
 */
export function ScanScreen({ taxonomy }: { taxonomy: PublicTaxonomy }) {
  const router = useRouter();
  const online = useOnline();
  const geo = useGeolocation();

  const [centre, setCentre] = useState({ lat: 12.9784, lng: 77.6408 });
  const [address, setAddress] = useState("");
  const [radiusKm, setRadiusKm] = useState(2);
  const [categoryIds, setCategoryIds] = useState<string[]>(() => {
    const standard = taxonomy.presets.find((p) => p.id === "standard-scan");
    return [...(standard?.categoryIds ?? [])];
  });

  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  /* ------------------------------------------------ restore the last plan */

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const plan = JSON.parse(raw) as StoredPlan;
      if (typeof plan.lat !== "number" || typeof plan.lng !== "number") return;
      setCentre({ lat: plan.lat, lng: plan.lng });
      setAddress(plan.address ?? "");
      if (RADII_KM.includes(plan.radiusKm as (typeof RADII_KM)[number])) setRadiusKm(plan.radiusKm);
      if (Array.isArray(plan.categoryIds) && plan.categoryIds.length > 0) {
        const known = new Set(taxonomy.categories.map((c) => c.id));
        setCategoryIds(plan.categoryIds.filter((id) => known.has(id)));
      }
    } catch {
      // A corrupt stored plan is not worth a broken screen.
    }
  }, [taxonomy]);

  useEffect(() => {
    try {
      const plan: StoredPlan = { ...centre, address, radiusKm, categoryIds };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } catch {
      // Private browsing, or a full quota. Nothing depends on this succeeding.
    }
  }, [centre, address, radiusKm, categoryIds]);

  /* -------------------------------------------------------- geolocation */

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setResolving(true);
    try {
      const { data } = await apiFetch<{ address: string | null }>("/api/scout/geo/resolve", {
        method: "POST",
        body: { lat, lng },
        timeoutMs: 15_000,
      });
      if (data.address) setAddress(data.address);
    } catch {
      // A pin with no printable address is still a perfectly good scan centre.
    } finally {
      setResolving(false);
    }
  }, []);

  const onPinMove = useCallback(
    (position: { lat: number; lng: number }) => {
      setCentre(position);
      void reverseGeocode(position.lat, position.lng);
    },
    [reverseGeocode],
  );

  /**
   * A new fix moves the pin.
   *
   * Keyed on the coordinates rather than on `geo.position`, which is a fresh
   * object on every fix and would re-run this on any unrelated render.
   */
  const fixLat = geo.status === "ready" ? (geo.position?.lat ?? null) : null;
  const fixLng = geo.status === "ready" ? (geo.position?.lng ?? null) : null;

  useEffect(() => {
    if (fixLat === null || fixLng === null) return;
    setCentre({ lat: fixLat, lng: fixLng });
    setAddress("");
    void reverseGeocode(fixLat, fixLng);
  }, [fixLat, fixLng, reverseGeocode]);

  async function lookUpAddress() {
    const query = address.trim();
    if (query.length < 2) return;
    setError(null);
    setResolving(true);
    try {
      const { data } = await apiFetch<{ lat: number; lng: number; address: string | null }>(
        "/api/scout/geo/resolve",
        { method: "POST", body: { address: query }, timeoutMs: 15_000 },
      );
      setCentre({ lat: data.lat, lng: data.lng });
      if (data.address) setAddress(data.address);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not look up that address.");
    } finally {
      setResolving(false);
    }
  }

  /* ----------------------------------------------------------- estimate */

  const estimateKey = useMemo(
    () => `${radiusKm}|${[...categoryIds].sort().join(",")}`,
    [radiusKm, categoryIds],
  );
  const debouncedKey = useDebounced(estimateKey, 350);

  useEffect(() => {
    const [radius, ids] = debouncedKey.split("|");
    if (!ids) {
      setEstimate(null);
      return;
    }
    const controller = new AbortController();
    apiFetch<EstimateResponse>(
      `/api/scout/scans/estimate?radiusM=${Number(radius) * 1_000}&categoryIds=${encodeURIComponent(ids)}`,
      { signal: controller.signal, retries: 0, timeoutMs: 12_000 },
    )
      .then(({ data }) => setEstimate(data))
      // The estimate is advisory. Losing it must never block the scan.
      .catch(() => setEstimate(null));
    return () => controller.abort();
  }, [debouncedKey]);

  /* ---------------------------------------------------------- run scan */

  async function runScan() {
    if (categoryIds.length === 0) {
      setError("Pick at least one thing to look for.");
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const { data } = await apiFetch<{ scanId: string }>("/api/scout/scans", {
        method: "POST",
        body: {
          areaLabel: areaLabelFrom(address, centre),
          address: address.trim() || null,
          centre,
          radiusM: radiusKm * 1_000,
          categoryIds,
        },
        // A scan create writes a few hundred rows over a mobile link. Give it room.
        timeoutMs: 40_000,
      });
      router.push(`/scout/m/scan/${data.scanId}`);
    } catch (e) {
      setStarting(false);
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not start the scan. Check your signal and try again.",
      );
    }
  }

  const selectedPreset = taxonomy.presets.find(
    (p) =>
      p.categoryIds.length === categoryIds.length &&
      p.categoryIds.every((id) => categoryIds.includes(id)),
  );

  return (
    <div className="mScreen">
      <FieldHeader
        statusLeft={online ? "Field mode" : "Offline"}
        statusRight="Site check"
        variant="brand"
        activeKey="scan"
      />

      <div className="mScroll ss-scroll pt-5 px-[var(--m-pad-x)] pb-6 flex flex-col gap-[22px] mIn">
        {/* ------------------------------------------- customer location */}
        <div className="flex flex-col gap-[9px]">
          <SectionLabel as="h1">Customer location</SectionLabel>

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-[9px] min-h-12 px-3.5 py-3 border border-black rounded-[var(--radius-12)] bg-black text-[var(--on-dark)] font-sans text-[length:var(--text-13-5)] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-progress"
              onClick={geo.request}
              disabled={geo.status === "locating"}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3.2" />
                <path d="M12 2v3.2M12 18.8V22M2 12h3.2M18.8 12H22" />
                <circle cx="12" cy="12" r="8" />
              </svg>
              {geo.status === "locating" ? "Finding you…" : "Use my current location"}
            </button>
          </div>

          {geo.message ? (
            <p className={geo.status === "denied" ? "text-[length:var(--text-11-5)] leading-normal text-track-600" : "text-[length:var(--text-11-5)] leading-normal text-[var(--m-muted)]"}>{geo.message}</p>
          ) : (
            <p className="text-[length:var(--text-11-5)] leading-normal text-[var(--m-muted)]">
              We only read your position when you tap this, and only to place the pin.
            </p>
          )}

          <div className="flex items-center gap-2.5 bg-[var(--surface-card)] border border-[var(--border-strong)] rounded-lg px-3.5 py-[13px] min-h-[var(--m-touch)]">
            <svg
              className="flex-none text-court-500"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <input
              className="flex-1 min-w-0 border-0 outline-0 font-sans text-sm text-[var(--ink)] bg-transparent"
              aria-label="Address or landmark"
              placeholder="Search an address or landmark"
              value={address}
              enterKeyHint="search"
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void lookUpAddress();
                }
              }}
            />
            <button
              type="button"
              className="flex-none min-h-12 px-3.5 py-3 border border-[var(--border-strong)] rounded-[var(--radius-12)] bg-[var(--surface-card)] text-[var(--ink)] font-sans text-[length:var(--text-13-5)] font-semibold cursor-pointer"
              onClick={() => void lookUpAddress()}
              disabled={resolving || address.trim().length < 2}
            >
              Find
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------- map */}
        <div className="flex flex-col gap-[9px]">
          <div className="rounded-[var(--radius-16)] overflow-hidden border border-[var(--border-strong)] relative">
            <SiteMap
              className="h-[220px] block"
              lat={centre.lat}
              lng={centre.lng}
              zoom={14}
              radius={radiusKm}
              interactive
              pin="drag"
              onPinMove={onPinMove}
              ariaLabel="Drag the pin to the customer's plot"
            />
          </div>
          <p className="flex items-center gap-[7px] text-[length:var(--text-11-5)] text-[var(--m-muted)] [&_svg]:flex-none">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
            </svg>
            <span>
              Drag the pin onto the exact plot &middot;{" "}
              <output className="tabular-nums" aria-live="polite">
                {`${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}`}
              </output>
            </span>
          </p>
        </div>

        {/* ---------------------------------------------------- radius */}
        <div className="flex flex-col gap-[11px]">
          <SectionLabel as="h2">Scan radius</SectionLabel>
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Scan radius">
            {RADII_KM.map((km) => (
              <button
                key={km}
                type="button"
                aria-pressed={radiusKm === km}
                className={`font-sans text-[length:var(--text-13-5)] font-semibold py-3.5 px-0 min-h-[var(--m-touch)] rounded-[var(--radius-12)] cursor-pointer transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-standard)] border ${
                  radiusKm === km
                    ? "bg-black text-[var(--on-dark)] border-black"
                    : "bg-[var(--surface-card)] text-[var(--ink)] border-[var(--border-strong)]"
                }`}
                onClick={() => setRadiusKm(km)}
              >
                {`${km} km`}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------ what to look for */}
        <div className="flex flex-col gap-[11px]">
          <div className="flex items-baseline justify-between gap-2.5">
            <SectionLabel as="h2">What to look for</SectionLabel>
            <span className="text-[length:var(--text-11-5)] text-[var(--m-muted)]">{`${categoryIds.length} selected`}</span>
          </div>

          {/*
           * Presets, rendered from the taxonomy rather than hardcoded — Phase 1
           * §18: adding a sport must not require a UI change. They matter on a
           * phone because a Full sweep is roughly five times the cost of a
           * Quick check, and the surveyor should learn that before running it.
           */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[length:var(--text-11-5)] text-[var(--m-muted)]">Presets</span>
            {taxonomy.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                aria-pressed={selectedPreset?.id === preset.id}
                className={`min-h-9 py-[7px] px-3 rounded-full font-sans text-xs font-semibold cursor-pointer border ${
                  selectedPreset?.id === preset.id
                    ? "border-solid border-[var(--accent)] text-court-700 bg-court-100"
                    : "border-dashed border-[var(--border-strong)] bg-transparent text-[var(--m-muted)]"
                }`}
                onClick={() => setCategoryIds([...preset.categoryIds])}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {taxonomy.categories.map((category) => {
              const on = categoryIds.includes(category.id);
              return (
                <Tag
                  key={category.id}
                  className="min-h-[var(--m-touch)]"
                  selected={on}
                  onClick={() =>
                    setCategoryIds((ids) =>
                      on ? ids.filter((id) => id !== category.id) : [...ids, category.id],
                    )
                  }
                >
                  {category.label}
                </Tag>
              );
            })}
          </div>
        </div>
      </div>

      <StickyFooter note={<EstimateNote estimate={estimate} online={online} error={error} />}>
        <Button block size="lg" onClick={() => void runScan()} disabled={starting || !online}>
          {starting ? "Starting scan…" : "Run scan"}
        </Button>
      </StickyFooter>
    </div>
  );
}

/**
 * The cost band, not the floor.
 *
 * A nearby term is exactly one call; a text term is one call per query string
 * and up to three pages each. Quoting `minCalls` as "the cost" is how a Full
 * sweep in Indiranagar surprises someone, so both ends are shown.
 */
function EstimateNote({
  estimate,
  online,
  error,
}: {
  estimate: EstimateResponse | null;
  online: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <span className="text-[length:var(--text-12-5)] leading-normal text-track-600 text-left" role="alert">
        {error}
      </span>
    );
  }
  if (!online) {
    return <>No network — a scan needs a connection. Everything you have set here is kept.</>;
  }
  if (!estimate) return <>Pick a radius and what to look for.</>;
  if (estimate.exceedsTileLimit) {
    return <>That radius covers too much ground to scan in one go. Try a smaller one.</>;
  }
  return (
    <>
      {`${estimate.tiles} tiles · ${estimate.minCalls}–${estimate.maxCalls} Google calls · `}
      {`$${estimate.minCostUsd.toFixed(2)}–$${estimate.maxCostUsd.toFixed(2)} · ${estimate.durationLabel}`}
    </>
  );
}

/**
 * The dashboard's card title. The first part of a formatted address is almost
 * always the locality a salesperson would say out loud ("Indiranagar"); with no
 * address at all, the coordinates are at least unambiguous.
 */
function areaLabelFrom(address: string, centre: { lat: number; lng: number }): string {
  const trimmed = address.trim();
  if (!trimmed) return `${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}`;
  const firstPart = trimmed.split(",")[0]?.trim();
  return (firstPart && firstPart.length > 2 ? firstPart : trimmed).slice(0, 200);
}
