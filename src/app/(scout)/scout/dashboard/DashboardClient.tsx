"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/scout/ui";
import { SectionLabel, StateBlock } from "@/components/scout/patterns";
import { ScoreBadge } from "@/components/scout/score";
import { atLeast, formatDayMonth, formatRadius, formatRating } from "@/lib/scout/display/format";
import type { DashboardScan, RecentReport } from "@/lib/scout/scans/queries";

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
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="flex gap-8 items-start max-[1100px]:flex-col">
        <div className="flex-1 min-w-0 flex flex-col gap-5">
          <div className="flex items-baseline justify-between gap-5 flex-wrap">
            <div>
              <h1 className="m-0 text-xl font-semibold">Saved scans</h1>
              <div className="text-sm text-slate-600 mt-2 tracking-normal normal-case font-sans">
                {summary.scansThisMonth} area{summary.scansThisMonth === 1 ? "" : "s"} scanned this
                month across {summary.owners} salesp{summary.owners === 1 ? "erson" : "eople"}
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <label className="flex items-center gap-[7px] text-xs text-slate-500">
                <span className="srOnly">Sort scans by</span>
                <select
                  className="font-sans text-sm py-2 px-3 rounded-md border border-slate-300 bg-white text-slate-900 cursor-pointer"
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
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-md py-2 px-3 w-[280px] focus-within:border-court-500 focus-within:shadow-sm max-[900px]:w-full">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="text-slate-400"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  className="flex-1 min-w-0 border-0 outline-none font-sans text-sm bg-transparent text-slate-900"
                  placeholder="Search area, customer or owner"
                  aria-label="Search area, customer or owner"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          {mixedBasis ? (
            <p className="border border-amber-400 rounded-xl bg-white py-3 px-3.5 text-sm leading-[1.65] text-slate-700" role="note">
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
                  : `Nothing matches "${query.trim()}"`
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
            <div className="grid grid-cols-3 gap-4 max-[1280px]:grid-cols-2 max-[900px]:grid-cols-1">
              {filtered.map((scan) => (
                <Link key={scan.id} href={`/scout/scan/${scan.id}`} className="card text-left p-4 cursor-pointer font-sans flex flex-col gap-3 no-underline text-slate-900 transition-colors hover:border-slate-300">
                  <span className="flex items-center justify-between gap-2.5">
                    <span className="text-sm font-semibold text-slate-900">{scan.areaLabel}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">{formatRadius(scan.radiusM)}</span>
                  </span>

                  <span className="flex gap-4">
                    <span className="block">
                      <span className="block font-mono text-xl font-semibold">
                        {scan.facilityCount === null
                          ? "—"
                          : atLeast(scan.facilityCount, scan.saturated)}
                      </span>
                      <span className="block text-xs text-slate-600 mt-[3px]">Facilities</span>
                    </span>
                    <span className="block">
                      <span className="block font-mono text-xl font-semibold text-court-700">
                        {scan.demandCount === null ? "—" : atLeast(scan.demandCount, scan.saturated)}
                      </span>
                      <span className="block text-xs text-slate-600 mt-[3px]">Demand</span>
                    </span>
                    <span className="block">
                      <span className="block font-mono text-xl font-semibold">{formatRating(scan.avgRating)}</span>
                      <span className="block text-xs text-slate-600 mt-[3px]">Avg rating</span>
                    </span>
                  </span>

                  <span className="border-t border-slate-200 pt-3">
                    <ScoreBadge
                      total={scan.scoreTotal}
                      verdict={scan.scoreVerdict}
                      basis={scan.scoreBasis}
                      confidence={scan.scoreConfidence}
                      size="sm"
                    />
                  </span>

                  <span className="flex items-center justify-between gap-2.5 border-t border-slate-200 pt-3 text-xs text-slate-500 mt-auto">
                    <span className="truncate">
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

        <div className="w-[360px] flex-none flex flex-col gap-5 max-[1100px]:w-full">
          <div className="bg-black text-white rounded-xl p-5 flex flex-col gap-3.5">
            <div className="font-heading uppercase tracking-[0.1em] text-xs text-court-400">Compare areas</div>
            <div className="text-sm leading-[1.6] text-white/75">
              Put two or three saved scans side by side before the pricing call.
            </div>
            <div className="flex gap-2 flex-wrap">
              {compareChips.length > 0 ? (
                compareChips.map((s) => (
                  <span key={s.id} className="text-xs bg-white/15 py-1 px-2.5 rounded-full text-white">
                    {s.areaLabel}
                  </span>
                ))
              ) : (
                <span className="text-xs bg-white/15 py-1 px-2.5 rounded-full text-white">No scans yet</span>
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

          <div className="card overflow-hidden">
            <div className="pt-4 px-4 pb-3">
              <SectionLabel weight={700}>Recent reports</SectionLabel>
            </div>
            {reports.length === 0 ? (
              <p className="pt-3.5 px-4 pb-[18px] text-sm leading-[1.65] text-slate-500 border-t border-slate-200">
                No reports yet. Open a scan and choose <strong>Create report</strong> to compose one.
              </p>
            ) : (
              reports.map((report) => (
                <Link
                  key={report.id}
                  href={`/scout/report/${report.scanId}`}
                  className="flex items-center gap-3 w-full text-left bg-white border-0 border-t border-slate-200 py-3.5 px-4 cursor-pointer font-sans no-underline text-slate-900 hover:bg-slate-100"
                >
                  <span className="w-[30px] h-[30px] rounded bg-slate-100 flex items-center justify-center flex-none text-slate-500">
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
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">{report.title}</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      {report.sentTo ? `Sent to ${report.sentTo} · ` : ""}
                      {formatDayMonth(report.sentAt ?? report.createdAt)}
                    </span>
                  </span>
                  <span
                    className={`text-xs font-semibold py-[3px] px-[9px] rounded-full flex-none ${
                      report.channel === "whatsapp" ? "bg-turf-100 text-turf-600" : "bg-slate-100 text-slate-700"
                    }`}
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
    return "font-semibold text-court-700 whitespace-nowrap";
  }
  if (scan.status === "report_sent") return "font-semibold text-turf-600 whitespace-nowrap";
  return "font-semibold text-slate-500 whitespace-nowrap";
}

function channelLabel(channel: RecentReport["channel"], status: string): string {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "email") return "Email";
  if (channel === "pdf") return "PDF";
  return status === "draft" ? "Draft" : "Generated";
}
