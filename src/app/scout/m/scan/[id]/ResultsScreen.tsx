"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { SiteMap } from "@/components/scout/map";
import type { SiteMapMarker } from "@/components/scout/map/siteMapConfig";
import {
  FieldHeader,
  OfflineBanner,
  SaturationRow,
  ScoreBlock,
  ScorePending,
  StickyFooter,
  apiFetch,
  ApiError,
  formatCount,
  formatDistance,
  formatNumber,
  formatRadius,
  formatRating,
  useOnline,
} from "@/components/scout/mobile";
import { SectionLabel } from "@/components/scout/patterns";
import { Button } from "@/components/scout/ui";
import type { ScanProgress, ScanResult, ScanResultPlace } from "@/lib/scout/places/scanResult";
import type { ScoreResult } from "@/lib/scout/scoring";
import styles from "./results.module.css";

interface ScoreResponse {
  readonly score: ScoreResult;
  readonly themesPending?: boolean;
}

/** How often progress is polled while a job is still moving. */
const POLL_MS = 2_500;

/**
 * Screen 02 — Results.
 *
 * ## The score goes first
 *
 * The mockup opens with the 2×2 stat grid. On a phone that is the wrong order:
 * the salesperson is standing in front of a land owner and the question in the
 * room is "is this site any good?" — not "how many reviews are there?". So the
 * Site Score is the first thing on the screen, above the fold, and the counts
 * that produced it follow underneath.
 *
 * Phase 3's rule holds regardless of the order: **the score never appears
 * without its breakdown.** Here the number itself is the control that opens the
 * five components, so there is no state of this screen where you can read 66
 * and not be one tap from why.
 *
 * ## Progressive, not a spinner
 *
 * `GET /api/scout/scans/{id}` is safe to call mid-scan and returns what has landed so
 * far, so the counts paint as the tiles complete rather than after two minutes
 * of nothing. `resumeRequired` on the progress payload is acted on by POSTing
 * `/run` — that is the mechanism that lets a scan which died at tile 6 of 8 on
 * bad signal carry on from tile 6.
 *
 * ## No population row
 *
 * Population is deferred in this build. It is omitted entirely rather than
 * shown as a placeholder — a greyed-out "Population: —" promises a number that
 * is not coming.
 */
export function ResultsScreen({ scanId }: { scanId: string }) {
  const router = useRouter();
  const online = useOnline();

  const [result, setResult] = useState<ScanResult | null>(null);
  const [staleAt, setStaleAt] = useState<Date | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [scoreState, setScoreState] = useState<"idle" | "loading" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  /* ------------------------------------------------------------- result */

  const loadResult = useCallback(async () => {
    try {
      const { data, staleAt: cachedAt } = await apiFetch<ScanResult>(`/api/scout/scans/${scanId}`);
      setResult(data);
      setStaleAt(cachedAt);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this scan.");
    }
  }, [scanId]);

  useEffect(() => {
    void loadResult();
  }, [loadResult]);

  /* ----------------------------------------------------------- progress */

  const jobRunning =
    progress !== null &&
    (progress.jobStatus === "queued" ||
      progress.jobStatus === "running" ||
      progress.jobStatus === "paused");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (cancelled) return;
      try {
        // Progress is never served from cache — a saved copy of "23 of 76" is
        // not information, it is a claim about a moment that has passed.
        const { data } = await apiFetch<ScanProgress>(`/api/scout/scans/${scanId}/progress`, {
          retries: 0,
          timeoutMs: 12_000,
        });
        if (cancelled) return;
        setProgress(data);

        const finished =
          data.jobStatus === "completed" ||
          data.jobStatus === "failed" ||
          data.jobStatus === "cancelled";

        if (!finished) {
          await loadResult();
          timer = setTimeout(() => void poll(), POLL_MS);
        } else {
          await loadResult();
        }
      } catch {
        // Offline. Stop polling; the banner already says what is going on.
        if (!cancelled) setProgress((p) => p);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanId, loadResult]);

  /* -------------------------------------------------------------- score */

  const scoreRequested = useRef(false);

  const loadScore = useCallback(
    async (compute: boolean) => {
      setScoreState("loading");
      try {
        const { data } = await apiFetch<ScoreResponse>(`/api/scout/scans/${scanId}/score`, {
          method: compute ? "POST" : "GET",
          // Scoring runs a handful of queries; give a slow link room.
          timeoutMs: compute ? 40_000 : 25_000,
        });
        setScore(data);
        setScoreState("idle");
      } catch (e) {
        if (e instanceof ApiError && e.code === "NOT_SCORED") {
          setScoreState("missing");
          return;
        }
        setScoreState("error");
      }
    },
    [scanId],
  );

  useEffect(() => {
    if (scoreRequested.current) return;
    scoreRequested.current = true;
    void loadScore(false);
  }, [loadScore]);

  /**
   * Compute the score once, when the scan finishes and none is stored.
   *
   * `GET` deliberately never re-scores — a stored score is the one the customer
   * was shown, and silently recomputing it under a newer model would change a
   * number somebody has already been told. So the first `POST` is explicit, and
   * every later refresh is one the surveyor asked for.
   */
  useEffect(() => {
    if (scoreState !== "missing") return;
    if (jobRunning) return;
    if (!result || result.places.length === 0) return;
    void loadScore(true);
  }, [scoreState, jobRunning, result, loadScore]);

  async function resume() {
    setResuming(true);
    try {
      await apiFetch(`/api/scout/scans/${scanId}/run`, { method: "POST", timeoutMs: 60_000 });
    } catch {
      // The next poll reports the real state; nothing is lost either way.
    } finally {
      setResuming(false);
    }
  }

  /* ------------------------------------------------------------- render */

  const exact = result ? !result.saturation.anySaturated : true;
  const competition = result?.places.filter((p) => p.side === "competition") ?? [];
  const nearest = competition.slice(0, 3);

  return (
    <div className="mScreen">
      <FieldHeader
        statusLeft={online ? "Field mode" : "Offline"}
        statusRight={progressStatus(progress)}
        backHref="/scout/m/scan"
        backLabel="Back to site check"
        title={result?.areaLabel ?? "Results"}
        subtitle={
          result
            ? `${formatRadius(result.radiusM)} radius · ${result.categories.length} ${
                result.categories.length === 1 ? "category" : "categories"
              }`
            : undefined
        }
        activeKey="results"
        navContext={{ scanId }}
      />

      <div className={`mScroll ss-scroll ${styles.body} mIn`}>
        {staleAt ? <OfflineBanner cachedAt={staleAt} subject="these scan results" /> : null}

        {error && !result ? (
          <p className={`${styles.notice} ${styles.error}`} role="alert">
            {error}
          </p>
        ) : null}

        {progress && jobRunning ? (
          <div className={styles.progress}>
            <div className={styles.progressLabel}>
              {/* Phase 1 writes this sentence; it is rendered verbatim. */}
              <span>{progress.label || "Scanning…"}</span>
              <span className={styles.progressPct}>{`${Math.round(progress.fraction * 100)}%`}</span>
            </div>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.fraction * 100)}
              aria-label="Scan progress"
            >
              <span
                className={styles.progressFill}
                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
              />
            </div>
            <p className={styles.progressNote}>
              Results fill in as tiles complete — you can read what is here already. The scan runs on
              the server, so leaving this screen does not stop it.
            </p>
            {progress.resumeRequired ? (
              <div className={styles.resume}>
                <Button variant="dark" block onClick={() => void resume()} disabled={resuming || !online}>
                  {resuming ? "Resuming…" : "Resume from where it stopped"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {progress?.jobStatus === "failed" ? (
          <div className={`${styles.notice} ${styles.error}`}>
            <p>
              {progress.error ??
                "The scan stopped before it finished. The tiles it already covered are kept."}
            </p>
            <div className={styles.resume}>
              <Button variant="dark" block onClick={() => void resume()} disabled={resuming || !online}>
                {resuming ? "Resuming…" : "Try the remaining tiles again"}
              </Button>
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------- score, first */}
        {score ? (
          <ScoreBlock
            score={score.score}
            themesPending={score.themesPending ?? false}
            onRefresh={() => void loadScore(true)}
          />
        ) : (
          <ScorePending
            message={
              scoreState === "loading"
                ? "Working out the site score…"
                : scoreState === "error"
                  ? "The site score could not be loaded. The counts below are unaffected."
                  : jobRunning
                    ? "The site score is calculated once the scan finishes."
                    : "No site score yet."
            }
          />
        )}

        {score ? <SaturationRow score={score.score} /> : null}

        {/* --------------------------------------------- stat grid */}
        {result ? (
          <>
            <div className={styles.statGrid}>
              <Stat
                label="Sports facilities"
                value={formatCount(result.competitionCount, exact)}
                sub={topCompetitionSub(result)}
                subGreen
              />
              <Stat
                label="Total reviews"
                value={formatNumber(result.reviewTotal)}
                sub={`across ${formatCount(result.competitionCount, exact)} places`}
              />
              <Stat
                label="Avg rating"
                value={formatRating(result.avgRating)}
                sub={
                  result.avgRating === null
                    ? "no competitor carries a rating"
                    : `${competition.filter((p) => typeof p.rating === "number").length} rated`
                }
              />
              <Stat
                label="Demand places"
                value={formatCount(result.demandCount, exact)}
                sub={demandSub(result)}
                dark
              />
            </div>

            <p className={styles.counts}>
              {`${result.distinctPlaces} distinct places, counted across ${Object.values(
                result.categoryCounts,
              ).reduce((a, b) => a + b, 0)} category memberships — a venue can belong to more than one.`}
              {exact
                ? ""
                : " Some searches hit Google's result ceiling, so every count here is a floor."}
            </p>

            {/* ------------------------------------ count table */}
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>Category</span>
                <span className={styles.tableNum}>Count</span>
                <span className={styles.tableMuted}>Reviews</span>
                <span className={styles.tableMuted}>Nearest</span>
              </div>
              {result.categories.map((category) => (
                <div
                  key={category.categoryId}
                  className={[
                    styles.tableRow,
                    category.side === "demand" && styles.tableRowDemand,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className={styles.tableName}>{category.label}</span>
                  <span className={styles.tableNum}>
                    {category.saturated ? (
                      <>
                        <span className={styles.saturatedMark} title="Google's result ceiling was reached — this is a floor">
                          ≥
                        </span>
                        {category.count}
                      </>
                    ) : (
                      category.count
                    )}
                  </span>
                  <span className={styles.tableMuted}>
                    {category.side === "demand" ? "—" : formatNumber(category.reviewTotal)}
                  </span>
                  <span className={styles.tableMuted}>
                    {formatDistance(category.nearest?.distanceM ?? null)}
                  </span>
                </div>
              ))}
            </div>

            {/* -------------------------------- nearest facilities */}
            {nearest.length > 0 ? (
              <div className={styles.section}>
                <SectionLabel as="h2">Nearest facilities</SectionLabel>
                <div className={styles.facilityList}>
                  {nearest.map((place) => (
                    <Link
                      key={place.placeId}
                      href={`/scout/m/place/${encodeURIComponent(place.placeId)}?scan=${scanId}`}
                      className={styles.facility}
                    >
                      <span className={styles.dot} aria-hidden="true" />
                      <span className={styles.facilityText}>
                        <span className={styles.facilityName}>{place.name}</span>
                        <span className={styles.facilityMeta}>{facilityMeta(place)}</span>
                      </span>
                      <span className={styles.facilityDistance}>
                        {formatDistance(place.distanceMRounded)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            {/* ------------------------------------ map preview */}
            <div className={styles.section}>
              <SectionLabel as="h2">Map preview</SectionLabel>
              <div className={styles.mapFrame}>
                <SiteMap
                  className={styles.map}
                  lat={result.centre.lat}
                  lng={result.centre.lng}
                  zoom={14}
                  radius={result.radiusM / 1_000}
                  markers={markersFrom(result.places)}
                  ariaLabel={`Map of ${result.areaLabel} showing facilities and demand anchors`}
                />
              </div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendFacility}`} />
                  Sports facility
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendDemand}`} />
                  School / college / workplace
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendPlot}`} />
                  Customer plot
                </span>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <StickyFooter
        note={
          staleAt
            ? "Saved copy — reconnect to create a report."
            : jobRunning
              ? "You can create the report now; it uses whatever has landed."
              : undefined
        }
      >
        <Button
          block
          size="lg"
          disabled={!result || Boolean(staleAt)}
          onClick={() => router.push(`/scout/m/report/${scanId}`)}
        >
          Create report
        </Button>
      </StickyFooter>
    </div>
  );
}

/* ------------------------------------------------------------ fragments */

function Stat({
  label,
  value,
  sub,
  dark = false,
  subGreen = false,
}: {
  label: string;
  value: string;
  sub: string;
  dark?: boolean;
  subGreen?: boolean;
}) {
  return (
    <div className={[styles.stat, dark && styles.statDark].filter(Boolean).join(" ")}>
      <div className={styles.statLabel}>{label}</div>
      <div className={[styles.statValue, value.length > 4 && styles.statValueLong].filter(Boolean).join(" ")}>
        {value}
      </div>
      <div
        className={[styles.statSub, subGreen && !dark && styles.statSubGreen].filter(Boolean).join(" ")}
      >
        {sub}
      </div>
    </div>
  );
}

function progressStatus(progress: ScanProgress | null): string {
  if (!progress) return "Results";
  if (progress.jobStatus === "completed") return "Scan complete";
  if (progress.jobStatus === "failed") return "Scan stopped";
  if (progress.jobStatus === "cancelled") return "Scan cancelled";
  return "Scanning…";
}

function topCompetitionSub(result: ScanResult): string {
  const top = result.categories
    .filter((c) => c.side === "competition")
    .reduce<{ label: string; count: number } | null>(
      (best, c) => (!best || c.count > best.count ? { label: c.label, count: c.count } : best),
      null,
    );
  if (!top) return "none found";
  return `${top.count} ${top.label.toLowerCase()}`;
}

function demandSub(result: ScanResult): string {
  const demand = result.categories.filter((c) => c.side === "demand").slice(0, 2);
  if (demand.length === 0) return "none found";
  return demand.map((c) => `${c.count} ${c.label.toLowerCase()}`).join(" · ");
}

function facilityMeta(place: ScanResultPlace): string {
  const parts: string[] = [];
  if (place.primaryTypeDisplayName) parts.push(place.primaryTypeDisplayName);
  if (typeof place.rating === "number") parts.push(`${place.rating.toFixed(1)} ★`);
  if (typeof place.reviewCount === "number") parts.push(`${formatNumber(place.reviewCount)} reviews`);
  return parts.join(" · ") || "No rating on Google";
}

/**
 * Cap the markers drawn on a 190px preview.
 *
 * Leaflet creates a DOM node per marker, and a full sweep can return several
 * hundred — enough to stutter on a mid-range Android while the user is trying
 * to scroll past the map. The nearest places are the ones the preview is for.
 */
function markersFrom(places: readonly ScanResultPlace[]): SiteMapMarker[] {
  return places.slice(0, 60).map((p) => ({
    lat: p.location.lat,
    lng: p.location.lng,
    type: p.side === "competition" ? "facility" : "demand",
    label: p.name,
  }));
}
