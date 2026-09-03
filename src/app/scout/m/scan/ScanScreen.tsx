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
import styles from "./scan.module.css";

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

      <div className={`mScroll ss-scroll ${styles.body} mIn`}>
        {/* ------------------------------------------- customer location */}
        <div className={styles.section}>
          <SectionLabel as="h1">Customer location</SectionLabel>

          <div className={styles.locateRow}>
            <button
              type="button"
              className={styles.locate}
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
            <p className={geo.status === "denied" ? styles.warn : styles.hint}>{geo.message}</p>
          ) : (
            <p className={styles.hint}>
              We only read your position when you tap this, and only to place the pin.
            </p>
          )}

          <div className={styles.addressRow}>
            <svg
              className={styles.pinIcon}
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
              className={styles.addressInput}
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
              className={styles.locateSecondary}
              onClick={() => void lookUpAddress()}
              disabled={resolving || address.trim().length < 2}
            >
              Find
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------- map */}
        <div className={styles.section}>
          <div className={styles.mapFrame}>
            <SiteMap
              className={styles.map}
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
          <p className={styles.pinReadout}>
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
              Drag the pin onto the exact plot ·{" "}
              <output className={styles.coords} aria-live="polite">
                {`${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}`}
              </output>
            </span>
          </p>
        </div>

        {/* ---------------------------------------------------- radius */}
        <div className={styles.sectionWide}>
          <SectionLabel as="h2">Scan radius</SectionLabel>
          <div className={styles.radiusGrid} role="group" aria-label="Scan radius">
            {RADII_KM.map((km) => (
              <button
                key={km}
                type="button"
                aria-pressed={radiusKm === km}
                className={[styles.radiusButton, radiusKm === km && styles.radiusButtonOn]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setRadiusKm(km)}
              >
                {`${km} km`}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------ what to look for */}
        <div className={styles.sectionWide}>
          <div className={styles.sectionHead}>
            <SectionLabel as="h2">What to look for</SectionLabel>
            <span className={styles.count}>{`${categoryIds.length} selected`}</span>
          </div>

          {/*
           * Presets, rendered from the taxonomy rather than hardcoded — Phase 1
           * §18: adding a sport must not require a UI change. They matter on a
           * phone because a Full sweep is roughly five times the cost of a
           * Quick check, and the surveyor should learn that before running it.
           */}
          <div className={styles.presets}>
            <span className={styles.presetLabel}>Presets</span>
            {taxonomy.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                aria-pressed={selectedPreset?.id === preset.id}
                className={[styles.preset, selectedPreset?.id === preset.id && styles.presetOn]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setCategoryIds([...preset.categoryIds])}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className={styles.tags}>
            {taxonomy.categories.map((category) => {
              const on = categoryIds.includes(category.id);
              return (
                <Tag
                  key={category.id}
                  className={styles.tag}
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
      <span className={styles.error} role="alert">
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
