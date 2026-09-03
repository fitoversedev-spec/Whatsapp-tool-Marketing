"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  FieldHeader,
  OfflineBanner,
  StickyFooter,
  apiFetch,
  ApiError,
  formatDate,
  formatRadius,
  useOnline,
} from "@/components/scout/mobile";
import { Button } from "@/components/scout/ui";
import styles from "./sites.module.css";

interface SavedScan {
  id: string;
  areaLabel: string;
  customerName: string | null;
  radiusM: number;
  status: string;
  facilityCount: number | null;
  demandCount: number | null;
  createdAt: string;
  scoreTotal: string | number | null;
  scoreVerdict: string | null;
  scoreBasis: string | null;
  scoreConfidence: string | null;
  jobStatus: string | null;
}

type VerdictFilter = "all" | "proceed" | "investigate" | "avoid" | "unscored";

const FILTERS: ReadonlyArray<{ id: VerdictFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "proceed", label: "Proceed" },
  { id: "investigate", label: "Investigate" },
  { id: "avoid", label: "Avoid" },
  { id: "unscored", label: "Not scored" },
];

/**
 * Screen 05 — My sites.
 *
 * ## Two additions to the mockup
 *
 * **A score badge per row**, and **a filter by verdict**. A salesperson with
 * twelve saved scans is looking for the two worth a second visit, and the
 * mockup's headline stat ("18 facilities · 26 demand places") does not answer
 * that — it is the input to the answer, not the answer.
 *
 * ## The badge always carries its basis
 *
 * A `desk_only` score is **not comparable** with a surveyed one: component 5 is
 * excluded and the remaining 85 points are rescaled to 100, so an unvisited
 * plot can outrank a visited one purely by having no observations. So the badge
 * is drawn as an outline and labelled "desk" whenever that is what it is, and
 * when a filtered list mixes the two bases the screen says so. Sorting or
 * ranking the two together without that warning is the exact failure Phase 3
 * made `score_basis` a database column to prevent.
 */
export function SitesScreen() {
  const router = useRouter();
  const online = useOnline();

  const [scans, setScans] = useState<SavedScan[]>([]);
  const [staleAt, setStaleAt] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<VerdictFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ scans: SavedScan[] }>("/api/scout/scans")
      .then(({ data, staleAt: cachedAt }) => {
        if (cancelled) return;
        setScans(data.scans);
        setStaleAt(cachedAt);
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Could not load your saved scans.");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scans.filter((scan) => {
      if (needle) {
        const haystack = `${scan.areaLabel} ${scan.customerName ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (filter === "all") return true;
      if (filter === "unscored") return !scan.scoreVerdict;
      return scan.scoreVerdict === filter;
    });
  }, [scans, query, filter]);

  const mixedBases =
    visible.some((s) => s.scoreBasis === "desk_only") && visible.some((s) => s.scoreBasis === "full");

  return (
    <div className="mScreen">
      <FieldHeader
        statusLeft={online ? "Field mode" : "Offline"}
        statusRight={`${scans.length} saved scan${scans.length === 1 ? "" : "s"}`}
        backHref="/scout/m/scan"
        backLabel="Back to site check"
        title="My sites"
        activeKey="sites"
        navContext={{ savedCount: scans.length }}
        search={{
          value: query,
          placeholder: "Search area or customer",
          label: "Search saved scans",
          onChange: setQuery,
        }}
      />

      <div className={`mScroll ss-scroll ${styles.body} mIn`}>
        {staleAt ? <OfflineBanner cachedAt={staleAt} subject="this list" /> : null}

        <div className={styles.filters} role="group" aria-label="Filter by verdict">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              className={[styles.filter, filter === f.id && styles.filterOn]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {mixedBases ? (
          <p className={`${styles.notice} ${styles.mixedWarning}`}>
            This list mixes surveyed scores with desk assessments. A desk score excludes the site
            survey and is rescaled to 100, so the two are not comparable — read the badges, not the
            order.
          </p>
        ) : null}

        {error ? (
          <p className={styles.notice} role="alert">
            {error}
          </p>
        ) : null}

        {loaded && visible.length === 0 ? (
          <p className={styles.empty}>
            {scans.length === 0
              ? "No scans yet. Stand on the plot, tap “New site check”, and use your current location."
              : "Nothing matches that search and filter."}
          </p>
        ) : null}

        {visible.map((scan) => (
          <Link key={scan.id} href={`/scout/m/scan/${scan.id}`} className={styles.row}>
            <span className={styles.rowText}>
              <span className={styles.area}>{scan.areaLabel}</span>
              <span className={styles.meta}>
                {`${formatDate(scan.createdAt)} · ${formatRadius(scan.radiusM)}`}
                {scan.customerName ? ` · ${scan.customerName}` : ""}
              </span>
              <span className={styles.headline}>{headline(scan)}</span>
            </span>

            <ScoreBadge scan={scan} />

            <svg
              className={styles.chevron}
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </div>

      <StickyFooter>
        <Button block size="lg" onClick={() => router.push("/scout/m/scan")}>
          New site check
        </Button>
      </StickyFooter>
    </div>
  );
}

function ScoreBadge({ scan }: { scan: SavedScan }) {
  const total = scan.scoreTotal === null ? null : Number(scan.scoreTotal);
  const verdict = scan.scoreVerdict;
  const desk = scan.scoreBasis === "desk_only";

  if (total === null || !Number.isFinite(total)) {
    return (
      <span className={`${styles.badge} ${styles.badgeNone}`} aria-label="Not scored yet">
        <span className={styles.badgeScore}>—</span>
        <span className={styles.badgeBasis}>none</span>
      </span>
    );
  }

  const tone =
    verdict === "proceed"
      ? styles.badgeProceed
      : verdict === "avoid"
        ? styles.badgeAvoid
        : styles.badgeInvestigate;

  return (
    <span
      className={[styles.badge, tone, desk && styles.badgeDesk].filter(Boolean).join(" ")}
      aria-label={`Score ${Math.round(total)} of 100, ${verdict ?? "unrated"}${
        desk ? ", desk assessment with no site survey" : ""
      }`}
    >
      <span className={styles.badgeScore}>{Math.round(total)}</span>
      <span className={styles.badgeBasis}>{desk ? "desk" : (verdict ?? "")}</span>
    </span>
  );
}

/** The mockup's headline stat, from the cached counts on the scan row. */
function headline(scan: SavedScan): string {
  if (scan.jobStatus && scan.jobStatus !== "completed" && scan.jobStatus !== "failed") {
    return "Scan still running";
  }
  const facilities = scan.facilityCount ?? 0;
  const demand = scan.demandCount ?? 0;
  return `${facilities} facilities · ${demand} demand places`;
}
