"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { ScoreBadge } from "@/components/scout/score";
import { atLeast, formatDayMonth, formatRadius, formatRating } from "@/lib/scout/display/format";
import type { DashboardScan, RecentReport } from "@/lib/scout/scans/queries";
import styles from "./Dashboard.module.css";

export interface DashboardClientProps {
  scans: DashboardScan[];
  reports: RecentReport[];
  summary: { scansThisMonth: number; owners: number };
}

type SortKey = "score" | "date" | "area";

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "date", label: "Newest first" },
  { id: "score", label: "Site score" },
  { id: "area", label: "Area name" },
];

/**
 * D1 — the saved-scan grid.
 *
 * Search and sort run entirely in the client over a list the server already
 * sent. At the volumes this desk works with — the mockup says twelve scans a
 * month across four salespeople — a round trip per keystroke would be slower
 * and would put the search box behind the network. `useDeferredValue` keeps
 * typing responsive if the list ever grows.
 *
 * ## Sorting by score is where `desk_only` bites
 *
 * A desk-only score excluded the site-practicals component and rescaled the
 * remaining 85 points to 100, so an unvisited plot can sit above a visited one
 * for no better reason than that nobody has been there. Every card carries the
 * label, and sorting by score raises a banner when the list mixes the two —
 * which is the moment the ranking stops meaning what it looks like it means.
 */
export function DashboardClient({ scans, reports, summary }: DashboardClientProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matched = q
      ? scans.filter((s) =>
          [s.areaLabel, s.customerName ?? "", s.ownerName]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : scans;

    const sorted = [...matched];
    if (sort === "score") {
      // Unscored scans sink rather than sorting as zero: "not scored" and
      // "scored zero" are different statements about a site.
      sorted.sort((a, b) => (b.scoreTotal ?? -1) - (a.scoreTotal ?? -1));
    } else if (sort === "area") {
      sorted.sort((a, b) => a.areaLabel.localeCompare(b.areaLabel));
    } else {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return sorted;
  }, [scans, deferredQuery, sort]);

  const mixedBasis =
    sort === "score" &&
    filtered.some((s) => s.scoreBasis === "desk_only") &&
    filtered.some((s) => s.scoreBasis === "full");

  const compareChips = scans.slice(0, 3);

  return (
    <div className={`${styles.screen} ss-scroll ssIn`}>
      <div className={styles.columns}>
        <div className={styles.main}>
          <div className={styles.head}>
            <div>
              <h1 className={styles.title}>Saved scans</h1>
              <div className={styles.lede}>
                {summary.scansThisMonth} area{summary.scansThisMonth === 1 ? "" : "s"} scanned this
                month across {summary.owners} salesp{summary.owners === 1 ? "erson" : "eople"}
              </div>
            </div>
            <div className={styles.controls}>
              <label className={styles.sort}>
                <span className="srOnly">Sort scans by</span>
                <select
                  className={styles.sortSelect}
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.search}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  color="var(--gray-500)"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  className={styles.searchInput}
                  placeholder="Search area, customer or owner"
                  aria-label="Search area, customer or owner"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          {mixedBasis ? (
            <p className={styles.mixedBasis} role="note">
              This ranking mixes desk-only scores with surveyed ones. A desk-only score excludes the
              site-practicals component and is rescaled to 100 without it, so an unvisited site can
              out-rank a surveyed one here. Survey the sites marked <strong>Desk only</strong> before
              reading this order as a ranking.
            </p>
          ) : null}

          {filtered.length === 0 ? (
            <StateBlock
              eyebrow={scans.length === 0 ? "Nothing saved yet" : "No match"}
              title={
                scans.length === 0
                  ? "No scans on this desk yet"
                  : `Nothing matches “${query.trim()}”`
              }
              body={
                scans.length === 0
                  ? "Run a scan to see the competing facilities and demand anchors around a plot. The area profile screen shows the cost before it spends anything."
                  : "Search covers the area name, the customer and the owner. Clear the box to see everything again."
              }
              action={
                scans.length === 0 ? (
                  <Link href="/scout/scan">
                    <Button>New scan</Button>
                  </Link>
                ) : (
                  <Button variant="secondary" onClick={() => setQuery("")}>
                    Clear the search
                  </Button>
                )
              }
            />
          ) : (
            <div className={styles.grid}>
              {filtered.map((scan) => (
                <Link key={scan.id} href={`/scout/scan/${scan.id}`} className={styles.card}>
                  <span className={styles.cardTop}>
                    <span className={styles.area}>{scan.areaLabel}</span>
                    <span className={styles.radius}>{formatRadius(scan.radiusM)}</span>
                  </span>

                  <span className={styles.stats}>
                    <span className={styles.stat}>
                      <span className={styles.statValue}>
                        {scan.facilityCount === null
                          ? "—"
                          : atLeast(scan.facilityCount, scan.saturated)}
                      </span>
                      <span className={styles.statLabel}>Facilities</span>
                    </span>
                    <span className={styles.stat}>
                      <span className={`${styles.statValue} ${styles.statValueAccent}`}>
                        {scan.demandCount === null ? "—" : atLeast(scan.demandCount, scan.saturated)}
                      </span>
                      <span className={styles.statLabel}>Demand</span>
                    </span>
                    <span className={styles.stat}>
                      <span className={styles.statValue}>{formatRating(scan.avgRating)}</span>
                      <span className={styles.statLabel}>Avg rating</span>
                    </span>
                  </span>

                  <span className={styles.cardScore}>
                    <ScoreBadge
                      total={scan.scoreTotal}
                      verdict={scan.scoreVerdict}
                      basis={scan.scoreBasis}
                      confidence={scan.scoreConfidence}
                      size="sm"
                    />
                  </span>

                  <span className={styles.cardFoot}>
                    <span className={styles.owner}>
                      {formatDayMonth(scan.createdAt)} · {scan.ownerName}
                      {scan.customerName ? ` · ${scan.customerName}` : ""}
                    </span>
                    <span className={statusClass(scan)}>{statusLabel(scan)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={styles.rail}>
          <div className={styles.compareCard}>
            <div className={styles.compareEyebrow}>Compare areas</div>
            <div className={styles.compareBody}>
              Put two or three saved scans side by side before the pricing call.
            </div>
            <div className={styles.chips}>
              {compareChips.length > 0 ? (
                compareChips.map((s) => (
                  <span key={s.id} className={styles.chip}>
                    {s.areaLabel}
                  </span>
                ))
              ) : (
                <span className={styles.chip}>No scans yet</span>
              )}
            </div>
            <Link
              href={
                compareChips.length > 0
                  ? `/scout/compare?ids=${compareChips.map((s) => s.id).join(",")}`
                  : "/scout/compare"
              }
            >
              <Button block>Open comparison</Button>
            </Link>
          </div>

          <div className={styles.reportsCard}>
            <div className={styles.reportsHead}>
              <SectionLabel weight={700}>Recent reports</SectionLabel>
            </div>
            {reports.length === 0 ? (
              <p className={styles.railEmpty}>
                No reports yet. Open a scan and choose <strong>Create report</strong> to compose one.
              </p>
            ) : (
              reports.map((report) => (
                <Link
                  key={report.id}
                  href={`/scout/report/${report.scanId}`}
                  className={styles.reportRow}
                >
                  <span className={styles.reportIcon}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                      <path d="M14 3v5h5" />
                    </svg>
                  </span>
                  <span className={styles.reportText}>
                    <span className={styles.reportName}>{report.title}</span>
                    <span className={styles.reportMeta}>
                      {report.sentTo ? `Sent to ${report.sentTo} · ` : ""}
                      {formatDayMonth(report.sentAt ?? report.createdAt)}
                    </span>
                  </span>
                  <span
                    className={report.channel === "whatsapp" ? styles.tagWhatsapp : styles.tagOther}
                  >
                    {channelLabel(report.channel, report.status)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function statusLabel(scan: DashboardScan): string {
  if (scan.jobStatus === "running" || scan.jobStatus === "queued" || scan.jobStatus === "paused") {
    const done = scan.completedTasks ?? 0;
    const total = scan.totalTasks ?? 0;
    return total > 0 ? `Scanning ${done}/${total}` : "Scanning";
  }
  if (scan.jobStatus === "failed") return "Scan failed";
  if (scan.status === "report_sent") return "Report sent";
  return "Scan only";
}

function statusClass(scan: DashboardScan): string {
  if (scan.jobStatus === "running" || scan.jobStatus === "queued" || scan.jobStatus === "paused") {
    return styles.statusRunning ?? "";
  }
  if (scan.status === "report_sent") return styles.statusSent ?? "";
  return styles.statusOnly ?? "";
}

function channelLabel(channel: RecentReport["channel"], status: string): string {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "email") return "Email";
  if (channel === "pdf") return "PDF";
  return status === "draft" ? "Draft" : "Generated";
}
