"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Tag } from "@/components/scout/ui";
import { SectionLabel, SkeletonBlock, StatCard, StateBlock } from "@/components/scout/patterns";
import { MARKER_COLORS, SiteMap, type SiteMapMarker } from "@/components/scout/map";
import { SaturationPanel, ScorePanel } from "@/components/scout/score";
import {
  atLeast,
  formatCallBand,
  formatCostBand,
  formatCount,
  formatDistance,
  formatRating,
} from "@/lib/scout/display/format";
import type {
  ScanPlaceDto,
  ScanProgressDto,
  ScanScreenData,
  TaxonomyDto,
} from "@/lib/scout/scans/dto";
import type { ScoreResult } from "@/lib/scout/scoring/types";


const RADII_KM = [1, 2, 3, 5] as const;
const RESULTS_PER_GROUP = 4;
/** Poll cadence while a job is running. One indexed row per call. */
const PROGRESS_POLL_MS = 1500;

interface EstimateResponse {
  tiles: number;
  terms: number;
  minCalls: number;
  maxCalls: number;
  minCostUsd: number;
  maxCostUsd: number;
  durationLabel: string;
  exceedsTileLimit: boolean;
}

export interface ScanScreenProps {
  taxonomy: TaxonomyDto;
  /** `null` on `/scout/scan` — a new, unrun scan. */
  initial: ScanScreenData | null;
  googleKeyMissing: boolean;
}

/**
 * D2 — the area profile.
 *
 * ## Why the estimate is live
 *
 * A Full sweep is roughly five times a Quick check, and cost grows with the
 * square of the radius. The surveyor is the person spending that money and is
 * the last person to see the bill, so the band — never the floor — is on screen
 * before the Run scan button is reachable. `GET /api/scout/scans/estimate` is pure
 * computation with no database and no Google call, so it is safe to hit on
 * every tick of the picker.
 *
 * ## Why progress streams
 *
 * A 2 km standard scan is around 31 tiles × 19 terms. That is tens of seconds,
 * sometimes minutes, and a spinner over it tells the surveyor nothing about
 * whether to wait or come back. Phase 1 writes a human label — "Searching
 * football turf… (23 of 76)" — and it is rendered verbatim, with the tile
 * count, the calls spent and the cache hits beside it.
 *
 * `resumeRequired` is the other half: if the browser that started the scan was
 * closed, the job is sitting paused with its completed work already in the
 * database. Seeing the flag, this screen POSTs `/run` and the scan carries on
 * from exactly where it stopped rather than restarting.
 */
export function ScanScreen({ taxonomy, initial, googleKeyMissing }: ScanScreenProps) {
  const router = useRouter();
  const isSaved = initial !== null;

  /* ---------------------------------------------------------- scan setup */

  const [address, setAddress] = useState(initial?.address ?? initial?.areaLabel ?? "");
  const [centre, setCentre] = useState(initial?.centre ?? { lat: 12.9784, lng: 77.6408 });
  const [radiusKm, setRadiusKm] = useState((initial?.radiusM ?? 2000) / 1000);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initial ? [...initial.categoryIds] : (taxonomy.presets[1]?.categoryIds ?? []).slice(),
  );
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{ formattedAddress: string; location: { lat: number | null; lng: number | null } }>
  >([]);

  /* -------------------------------------------------------------- results */

  const [data, setData] = useState<ScanScreenData | null>(initial);
  const [progress, setProgress] = useState<ScanProgressDto | null>(initial?.progress ?? null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const [score, setScore] = useState<ScoreResult | null>(initial?.score ?? null);
  const [themesPending, setThemesPending] = useState(false);

  /* ------------------------------------------------------------- estimate */

  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);

  useEffect(() => {
    if (selectedCategories.length === 0) {
      setEstimate(null);
      return;
    }
    const controller = new AbortController();
    // Debounced: the picker fires on every tick and the estimate is cheap, but
    // a request per tick would still queue behind itself on a slow line.
    const timer = setTimeout(() => {
      setEstimateLoading(true);
      fetch(
        `/api/scout/scans/estimate?radiusM=${radiusKm * 1000}&categoryIds=${selectedCategories.join(",")}`,
        { signal: controller.signal },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => setEstimate(json as EstimateResponse | null))
        .catch(() => undefined)
        .finally(() => setEstimateLoading(false));
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedCategories, radiusKm]);

  /* -------------------------------------------------------- progress poll */

  const scanId = data?.scanId ?? null;
  const jobLive =
    progress !== null &&
    ["queued", "running", "paused"].includes(progress.jobStatus) &&
    scanId !== null;

  const refreshResults = useCallback(async (id: string) => {
    const res = await fetch(`/api/scout/scans/${id}/screen`, { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as ScanScreenData;
    setData(json);
    setProgress(json.progress);
    if (json.score) setScore(json.score);
  }, []);

  useEffect(() => {
    if (!jobLive || !scanId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/api/scout/scans/${scanId}/progress`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as ScanProgressDto;
        if (cancelled) return;
        setProgress(next);

        // The scan survives a disconnect: the completed work is rows in the
        // database, so any caller can move the job along from where it stopped.
        if (next.resumeRequired) {
          void fetch(`/api/scout/scans/${scanId}/run`, { method: "POST" });
        }
        if (["completed", "failed", "cancelled"].includes(next.jobStatus)) {
          await refreshResults(scanId);
          return;
        }
        // Paint partial results as they land rather than holding a spinner.
        if (next.completed > 0 && next.completed % 8 === 0) void refreshResults(scanId);
      } finally {
        if (!cancelled) timer = setTimeout(tick, PROGRESS_POLL_MS);
      }
    };

    timer = setTimeout(tick, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobLive, scanId, refreshResults]);

  /* ------------------------------------------------------------ geocoding */

  const lookupAddress = useCallback(async () => {
    const q = address.trim();
    if (!q) return;
    setGeocoding(true);
    setGeocodeError(null);
    setSuggestions([]);
    try {
      const res = await fetch(`/api/scout/geocode?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as {
        results?: Array<{
          formattedAddress: string;
          location: { lat: number | null; lng: number | null };
        }>;
        error?: string;
      };
      if (json.error && (json.results?.length ?? 0) === 0) {
        setGeocodeError(json.error);
        return;
      }
      const results = json.results ?? [];
      if (results.length === 1 && results[0]) {
        applySuggestion(results[0]);
      } else {
        setSuggestions(results);
      }
    } catch {
      setGeocodeError("The address lookup failed. Drag the pin instead.");
    } finally {
      setGeocoding(false);
    }
  }, [address]);

  function applySuggestion(s: {
    formattedAddress: string;
    location: { lat: number | null; lng: number | null };
  }) {
    if (s.location.lat === null || s.location.lng === null) return;
    setCentre({ lat: s.location.lat, lng: s.location.lng });
    setAddress(s.formattedAddress);
    setSuggestions([]);
  }

  /* ------------------------------------------------------------- run scan */

  const runScan = useCallback(async () => {
    setRunError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/scout/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          areaLabel: address.trim() ? address.trim().split(",")[0] : "Untitled area",
          centre,
          radiusM: Math.round(radiusKm * 1000),
          categoryIds: selectedCategories,
          address: address.trim() || null,
        }),
      });
      const json = (await res.json()) as { scanId?: string; error?: string };
      if (!res.ok || !json.scanId) {
        setRunError(json.error ?? "The scan could not be created.");
        return;
      }
      router.push(`/scout/scan/${json.scanId}`);
    } catch {
      setRunError("The scan request did not reach the server. Check the connection and try again.");
    } finally {
      setRunning(false);
    }
  }, [address, centre, radiusKm, selectedCategories, router]);

  /* --------------------------------------------------------------- score */

  const computeScore = useCallback(async () => {
    if (!scanId) return;
    setScoring(true);
    try {
      const res = await fetch(`/api/scout/scans/${scanId}/score`, { method: "POST" });
      const json = (await res.json()) as {
        score?: ScoreResult;
        themesPending?: boolean;
        error?: string;
      };
      if (res.ok && json.score) {
        setScore(json.score);
        setThemesPending(json.themesPending === true);
      } else {
        setRunError(json.error ?? "The score could not be computed.");
      }
    } catch {
      setRunError("The scoring request failed. Try again in a moment.");
    } finally {
      setScoring(false);
    }
  }, [scanId]);

  /* -------------------------------------------------------------- derived */

  const markers = useMemo<SiteMapMarker[]>(
    () =>
      (data?.places ?? []).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        type: p.side === "competition" ? "facility" : "demand",
        placeId: p.placeId,
        name: p.name,
      })),
    [data?.places],
  );

  const groups = useMemo(() => groupPlaces(data, taxonomy), [data, taxonomy]);
  const selectedPlace = useMemo(
    () => data?.places.find((p) => p.placeId === selectedPlaceId) ?? null,
    [data?.places, selectedPlaceId],
  );

  const selectedTermCount = useMemo(
    () =>
      taxonomy.categories
        .filter((c) => selectedCategories.includes(c.id))
        .reduce((sum, c) => sum + c.termCount, 0),
    [taxonomy.categories, selectedCategories],
  );

  const competition = taxonomy.categories.filter((c) => c.side === "competition");
  const demand = taxonomy.categories.filter((c) => c.side === "demand");

  const activePreset = taxonomy.presets.find(
    (p) =>
      p.categoryIds.length === selectedCategories.length &&
      p.categoryIds.every((id) => selectedCategories.includes(id)),
  );

  const scrollTargetRef = useRef<HTMLDivElement | null>(null);

  /** Map marker → list row. The list is inside a scrolling panel. */
  const selectFromMap = useCallback((marker: SiteMapMarker) => {
    const id = typeof marker.placeId === "string" ? marker.placeId : null;
    setSelectedPlaceId(id);
    if (!id) return;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-place-row="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  return (
    <div className="flex-1 flex min-h-0 max-[900px]:flex-col ssIn">
      <aside className="w-[400px] flex-none bg-white border-r border-slate-200 overflow-y-auto pt-6 px-5 pb-8 flex flex-col gap-5 max-[900px]:w-full max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:border-slate-200 ss-scroll" ref={scrollTargetRef}>
        {/* ---------------------------------------------------- customer plot */}
        <div className="flex flex-col gap-2">
          <SectionLabel weight={700}>Customer plot</SectionLabel>
          <div className="flex items-center gap-2 border border-slate-300 rounded-lg py-3 px-3 focus-within:border-court-500 focus-within:ring-1 focus-within:ring-court-500/20">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--blue-bright)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <input
              className="flex-1 min-w-0 border-0 outline-none font-sans text-sm bg-transparent text-slate-900"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void lookupAddress();
                }
              }}
              placeholder="Address or landmark"
              aria-label="Address or landmark"
              disabled={isSaved}
            />
            {!isSaved ? (
              <button
                type="button"
                className="bg-transparent border-0 p-0 font-sans text-xs font-semibold uppercase text-court-500 cursor-pointer flex-none disabled:text-slate-300 disabled:cursor-not-allowed"
                onClick={() => void lookupAddress()}
                disabled={geocoding || address.trim().length === 0}
              >
                {geocoding ? "…" : "Find"}
              </button>
            ) : null}
          </div>

          {suggestions.length > 0 ? (
            <ul className="list-none m-0 p-0 border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-200">
              {suggestions.map((s) => (
                <li key={s.formattedAddress}>
                  <button
                    type="button"
                    className="block w-full text-left bg-white border-0 py-[10px] px-3 font-sans text-sm text-slate-900 cursor-pointer hover:bg-slate-100"
                    onClick={() => applySuggestion(s)}
                  >
                    {s.formattedAddress}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {geocodeError ? <p className="m-0 text-xs leading-[1.6] text-red-600">{geocodeError}</p> : null}
          <p className="m-0 text-xs leading-[1.6] text-slate-500">
            {isSaved
              ? `Scan centre ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}.`
              : `Drag the pin to fine-tune. Centre ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}.`}
          </p>

          <div className="grid grid-cols-4 gap-2 mt-1">
            {RADII_KM.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={radiusKm === r}
                disabled={isSaved}
                className={`font-sans text-sm font-semibold py-2 rounded-lg cursor-pointer border ${
                  radiusKm === r
                    ? "bg-black text-white border-black"
                    : "bg-white text-slate-900 border-slate-300"
                }`}
                onClick={() => setRadiusKm(r)}
              >
                {r} km
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------- category picker */}
        {!isSaved ? (
          <>
            <div className="flex flex-col gap-[10px]">
              <SectionLabel weight={700}>Preset</SectionLabel>
              <div className="flex gap-2 flex-wrap">
                {taxonomy.presets.map((preset) => (
                  <Tag
                    key={preset.id}
                    selected={activePreset?.id === preset.id}
                    onClick={() => setSelectedCategories([...preset.categoryIds])}
                  >
                    {preset.label}
                  </Tag>
                ))}
              </div>
              <p className="m-0 text-xs leading-[1.6] text-slate-500">
                {activePreset?.description ??
                  "A custom selection. Pick a preset to reset it, or tick categories below."}
              </p>
            </div>

            <div className="flex flex-col gap-[10px]">
              <SectionLabel weight={700}>Competition</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {competition.map((c) => (
                  <Tag
                    key={c.id}
                    selected={selectedCategories.includes(c.id)}
                    onClick={() => toggleCategory(setSelectedCategories, c.id)}
                  >
                    {c.label}
                    <span className="text-xs text-slate-500 ml-[5px]">{c.termCount}</span>
                  </Tag>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-[10px]">
              <SectionLabel weight={700}>Demand pool</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {demand.map((c) => (
                  <Tag
                    key={c.id}
                    selected={selectedCategories.includes(c.id)}
                    onClick={() => toggleCategory(setSelectedCategories, c.id)}
                  >
                    {c.label}
                    <span className="text-xs text-slate-500 ml-[5px]">{c.termCount}</span>
                  </Tag>
                ))}
              </div>
            </div>

            {/* ------------------------------------------------- live estimate */}
            <div className="border border-slate-200 rounded-lg p-[13px] flex flex-col gap-2 bg-slate-100" aria-live="polite">
              <div className="flex items-baseline justify-between gap-[10px]">
                <SectionLabel weight={700}>Before you spend it</SectionLabel>
                <span className="font-mono text-xl font-semibold text-slate-900">
                  {estimate ? formatCostBand(estimate.minCostUsd, estimate.maxCostUsd) : "—"}
                </span>
              </div>
              {selectedCategories.length === 0 ? (
                <p className="m-0 text-xs leading-[1.6] text-slate-500">Pick at least one category to see the cost.</p>
              ) : estimate ? (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500 [&_strong]:text-slate-700 [&_strong]:font-semibold">
                    <span>
                      Tiles <strong>{formatCount(estimate.tiles)}</strong>
                    </span>
                    <span>
                      Search terms <strong>{formatCount(selectedTermCount)}</strong>
                    </span>
                    <span>
                      Billable calls{" "}
                      <strong>{formatCallBand(estimate.minCalls, estimate.maxCalls)}</strong>
                    </span>
                    <span>
                      Duration <strong>{estimate.durationLabel}</strong>
                    </span>
                  </div>
                  <p className="m-0 text-xs leading-[1.6] text-slate-500">
                    A band, not a floor: a text term is one call per query string and may paginate
                    three times per tile. A warm cache costs nothing.
                  </p>
                  {estimate.exceedsTileLimit ? (
                    <p className="m-0 text-xs leading-[1.6] text-red-600">
                      This plan needs more tiles than the configured ceiling allows and will be
                      refused. Reduce the radius.
                    </p>
                  ) : null}
                </>
              ) : estimateLoading ? (
                <SkeletonBlock label="Working out the cost" lines={2} />
              ) : null}
            </div>

            {googleKeyMissing ? (
              <StateBlock
                tone="error"
                eyebrow="Cannot scan"
                title="No Google Places key is configured"
                body="Scans need GOOGLE_MAPS_SERVER_KEY. Enable Places API (New) and Geocoding in the Google Cloud project, create a server key with an API restriction, and put it in the environment. Everything else on this screen works without it."
              />
            ) : null}

            {runError ? (
              <StateBlock tone="error" title="The scan did not start" body={runError} />
            ) : null}

            <Button
              block
              onClick={() => void runScan()}
              disabled={running || selectedCategories.length === 0 || googleKeyMissing}
            >
              {running ? "Starting the scan…" : "Run scan"}
            </Button>
          </>
        ) : null}

        {/* ----------------------------------------------------- live progress */}
        {progress && ["queued", "running", "paused"].includes(progress.jobStatus) ? (
          <div className="border border-court-500 rounded-lg p-[13px] flex flex-col gap-2 bg-court-100" aria-live="polite">
            <div className="text-sm font-semibold text-court-700">{progress.label}</div>
            <div className="h-2 rounded-full bg-white overflow-hidden">
              <span
                className="block h-full bg-court-500 rounded-full transition-[width] duration-200"
                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
              />
            </div>
            <div className="flex justify-between gap-[10px] text-xs text-slate-600">
              <span>
                {progress.completed} of {progress.total} searches · {progress.tileCount} tiles
              </span>
              <span>
                {progress.calls} calls · {progress.cacheHits} cached
              </span>
            </div>
            <p className="m-0 text-xs leading-[1.6] text-slate-500">
              Results appear below as they land. You can leave this screen — the scan is a job in the
              database and picks up where it stopped.
            </p>
          </div>
        ) : null}

        {progress?.jobStatus === "failed" ? (
          <StateBlock
            tone="error"
            title="The scan stopped before it finished"
            body={
              <>
                {progress.error ?? "The ingestion job failed."} Its completed searches are saved, so
                restarting resumes rather than re-buying them.
              </>
            }
            action={
              scanId ? (
                <Button
                  variant="secondary"
                  onClick={() => void fetch(`/api/scout/scans/${scanId}/run`, { method: "POST" })}
                >
                  Resume the scan
                </Button>
              ) : null
            }
          />
        ) : null}

        {/* --------------------------------------------------------- results */}
        {data ? (
          <>
            <div className="grid grid-cols-2 gap-[10px]">
              <StatCard
                label="Facilities"
                value={atLeast(data.competitionCount, data.anySaturated)}
              />
              <StatCard label="Reviews" value={formatCount(data.reviewTotal)} />
              <StatCard label="Avg rating" value={formatRating(data.avgRating)} />
              <StatCard
                label="Demand places"
                value={atLeast(data.demandCount, data.anySaturated)}
                inverted
              />
            </div>

            <p className="m-0 text-xs leading-[1.6] text-slate-500">
              {formatCount(data.distinctPlaces)} distinct places, counted across{" "}
              {formatCount(Object.values(data.categoryCounts).reduce((a, b) => a + b, 0))} category
              memberships — a venue can be both a turf and an academy, so the two do not sum.
            </p>

            {data.categories.length > 0 ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1.3fr_0.5fr_0.7fr_0.7fr] gap-[6px] py-[10px] px-3 bg-slate-100 text-xs font-bold text-slate-600">
                  <span>Category</span>
                  <span className="text-right">Count</span>
                  <span className="text-right">Reviews</span>
                  <span className="text-right">Nearest</span>
                </div>
                {data.categories.map((c) => (
                  <div key={c.categoryId} className="grid grid-cols-[1.3fr_0.5fr_0.7fr_0.7fr] gap-[6px] py-[10px] px-3 text-xs border-t border-slate-200 [&>span:first-child]:font-semibold">
                    <span>{c.label}</span>
                    <span className="text-right">
                      {atLeast(c.count, c.saturated)}
                      {c.saturated ? (
                        <span
                          className="text-amber-400 font-bold cursor-help"
                          title="A search for this category returned the maximum results a single query can, so the count is a floor."
                        >
                          {" "}
                          ▲
                        </span>
                      ) : null}
                    </span>
                    <span className="text-right text-slate-500">
                      {c.reviewTotal > 0 ? formatCount(c.reviewTotal) : "—"}
                    </span>
                    <span className="text-right text-slate-500">
                      {c.nearestM === null ? "—" : formatDistance(c.nearestM)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* ------------------------------------------------- score panel */}
            {score ? (
              <>
                <ScorePanel
                  score={score}
                  scoredAt={data.scoredAt}
                  themesPending={themesPending}
                  onRefresh={() => void computeScore()}
                />
                <SaturationPanel
                  score={score}
                  radiusM={data.radiusM}
                  saturatedTerms={data.saturatedTerms}
                />
              </>
            ) : data.status !== "draft" ? (
              <StateBlock
                eyebrow="Not scored yet"
                title="Score this scan"
                body="Scoring is a server-side computation over the places above, the city benchmark and — if one has been recorded — the site survey. Without a survey the score is desk-only and is labelled as such wherever it appears."
                action={
                  <Button onClick={() => void computeScore()} disabled={scoring}>
                    {scoring ? "Scoring…" : "Compute the site score"}
                  </Button>
                }
              />
            ) : null}

            {/* ------------------------------------------------ result groups */}
            {groups.length > 0 ? (
              <div className="flex flex-col gap-2">
                <SectionLabel weight={700}>Results</SectionLabel>
                {groups.map((group) => {
                  const expanded = expandedGroups[group.id] === true;
                  const shown = expanded ? group.places : group.places.slice(0, RESULTS_PER_GROUP);
                  return (
                    <div key={group.id} className="flex flex-col gap-[6px] mb-[6px]">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <span
                          className="w-2 h-2 rounded-full flex-none"
                          style={{
                            background:
                              group.side === "competition"
                                ? MARKER_COLORS.facility
                                : MARKER_COLORS.demand,
                          }}
                        />
                        {group.label}
                        <span className="text-slate-500 font-normal">
                          {atLeast(group.places.length, group.saturated)} shown
                        </span>
                      </div>
                      {shown.map((place) => (
                        <button
                          key={place.placeId}
                          type="button"
                          data-place-row={place.placeId}
                          className={`flex items-center gap-[10px] border rounded-lg py-2 px-3 w-full text-left bg-white font-sans cursor-pointer ${
                            selectedPlaceId === place.placeId
                              ? "border-court-500 bg-court-100"
                              : "border-slate-200 hover:border-slate-300"
                          }`}
                          aria-pressed={selectedPlaceId === place.placeId}
                          onClick={() =>
                            setSelectedPlaceId((current) =>
                              current === place.placeId ? null : place.placeId,
                            )
                          }
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-slate-900">{place.name}</span>
                            <span className="block text-xs text-slate-500 mt-0.5">
                              {[
                                place.primaryTypeDisplayName,
                                place.rating === null
                                  ? null
                                  : `${place.rating.toFixed(1)} ★ ${formatCount(place.reviewCount ?? 0)}`,
                                place.businessStatus && place.businessStatus !== "OPERATIONAL"
                                  ? place.businessStatus.toLowerCase().replaceAll("_", " ")
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "No detail from Google"}
                            </span>
                          </span>
                          <span className="text-xs text-slate-500 flex-none">
                            {formatDistance(place.distanceM)}
                          </span>
                        </button>
                      ))}
                      {group.places.length > RESULTS_PER_GROUP ? (
                        <button
                          type="button"
                          className="bg-transparent border-0 py-1 px-0 font-sans text-xs text-court-500 cursor-pointer text-left"
                          onClick={() =>
                            setExpandedGroups((prev) => ({ ...prev, [group.id]: !expanded }))
                          }
                        >
                          {expanded
                            ? "Show fewer"
                            : `Show all ${group.places.length} in ${group.label}`}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {scanId ? (
              <Link href={`/scout/report/${scanId}`}>
                <Button block>Create report</Button>
              </Link>
            ) : null}
            {scanId ? (
              <Link href={`/scout/sweep?scanId=${scanId}`}>
                <Button block variant="secondary">
                  Sweep this area for spaces
                </Button>
              </Link>
            ) : null}
          </>
        ) : null}
      </aside>

      <div className="flex-1 min-w-0 relative max-[900px]:min-h-[320px]">
        <SiteMap
          className="absolute inset-0 block"
          lat={centre.lat}
          lng={centre.lng}
          radius={radiusKm}
          markers={markers}
          interactive
          pin={isSaved ? "fixed" : "drag"}
          onPinMove={isSaved ? undefined : setCentre}
          onMarkerTap={selectFromMap}
          ariaLabel="Catchment map. Facilities and demand anchors are plotted around the scan centre."
        />

        <div className="absolute left-5 top-5 z-[500] bg-white/95 border border-slate-200 rounded-lg py-[13px] px-[15px] flex flex-col gap-2 shadow-[0_6px_18px_rgba(0,0,0,0.1)]">
          <SectionLabel weight={700}>Legend</SectionLabel>
          <span className="flex items-center gap-2 text-xs">
            <span
              className="w-[9px] h-[9px] rounded-full"
              style={{ background: MARKER_COLORS.facility }}
              aria-hidden="true"
            />
            Sports facility
          </span>
          <span className="flex items-center gap-2 text-xs">
            <span
              className="w-[9px] h-[9px] rounded-full"
              style={{ background: MARKER_COLORS.demand }}
              aria-hidden="true"
            />
            Demand anchor
          </span>
          <span className="flex items-center gap-2 text-xs">
            <span
              className="w-[9px] h-[9px] rounded-full"
              style={{ background: MARKER_COLORS.plot }}
              aria-hidden="true"
            />
            Customer plot
          </span>
        </div>

        {selectedPlace ? (
          <div className="absolute right-5 top-5 z-[500] max-w-[300px] bg-white border border-slate-200 rounded-lg py-[13px] px-[15px] shadow-[0_6px_18px_rgba(0,0,0,0.12)] flex flex-col gap-[6px] animate-[ssIn_var(--dur-med)_var(--ease-standard)]">
            <button
              type="button"
              className="absolute right-2 top-[6px] bg-transparent border-0 text-slate-500 text-sm cursor-pointer leading-none p-1"
              aria-label="Close"
              onClick={() => setSelectedPlaceId(null)}
            >
              ✕
            </button>
            <span className="text-sm font-semibold">{selectedPlace.name}</span>
            <span className="text-xs text-slate-500 leading-[1.6]">
              {formatDistance(selectedPlace.distanceM)} from the centre ·{" "}
              {selectedPlace.side === "competition" ? "competition" : "demand anchor"}
              {selectedPlace.rating !== null
                ? ` · ${selectedPlace.rating.toFixed(1)} ★ ${formatCount(selectedPlace.reviewCount ?? 0)}`
                : ""}
            </span>
            <Badge tone={selectedPlace.side === "competition" ? "green" : "blue"}>
              {selectedPlace.categories.join(", ") || selectedPlace.side}
            </Badge>
            {selectedPlace.googleMapsUri ? (
              <a
                className="text-xs"
                href={selectedPlace.googleMapsUri}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Google Maps
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function toggleCategory(
  set: React.Dispatch<React.SetStateAction<string[]>>,
  id: string,
): void {
  // Optimistic by construction: the picker is local state, and the estimate
  // that depends on it is recomputed rather than awaited.
  set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
}

interface ResultGroup {
  id: string;
  label: string;
  side: "competition" | "demand";
  saturated: boolean;
  places: ScanPlaceDto[];
}

/**
 * Group the result list by category, in taxonomy order.
 *
 * A place in two categories appears in both groups — that is the multi-category
 * membership Phase 1 fixed, and hiding it would recreate the bug where a venue
 * was claimed by whichever term ran first. The distinct total is printed above
 * the table so the two never look like a contradiction.
 */
function groupPlaces(data: ScanScreenData | null, taxonomy: TaxonomyDto): ResultGroup[] {
  if (!data) return [];
  const byCategory = new Map<string, ScanPlaceDto[]>();
  for (const place of data.places) {
    for (const categoryId of place.categories) {
      const list = byCategory.get(categoryId) ?? [];
      list.push(place);
      byCategory.set(categoryId, list);
    }
  }

  const groups: ResultGroup[] = [];
  for (const category of taxonomy.categories) {
    const places = byCategory.get(category.id);
    if (!places || places.length === 0) continue;
    groups.push({
      id: category.id,
      label: category.label,
      side: category.side,
      saturated: data.categories.find((c) => c.categoryId === category.id)?.saturated ?? false,
      places: places.sort((a, b) => a.distanceM - b.distanceM),
    });
  }
  return groups;
}
