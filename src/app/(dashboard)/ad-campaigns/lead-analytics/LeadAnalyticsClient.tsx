"use client";

// Lead Analytics — a dedicated admin page over the CAPTURED Meta lead-form
// submissions (MetaLead), separate from the Ad Campaigns performance page.
// Three views, each fed by src/lib/meta-ads/leadAnalytics.ts:
//   • Leads by city   — where the demand is (horizontal bar + share donut)
//   • Sport demand    — which sport each city most wants (city×sport stacked bar)
//   • Repeat leads     — people who came back across >1 campaign (table)
// plus <MetaAiSummary/> for plain-English questions + AI recommendations, which
// answer only from the same real lead data (the by_city / by_sport /
// repeat_leads tools). Same ?from/?to range convention as AdCampaignsClient:
// applying a range pushes the query string and the server page re-fetches.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { DataTable } from "@/components/analytics/DataTable";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { HorizontalBarChart, StackedBarChart, DonutChart, DONUT_PALETTE } from "@/components/analytics/charts";
import MetaAiSummary from "@/components/MetaAiSummary";
import type { LeadCityRow, SportCityCell, RepeatLeadRow, JobCityCell, AreaCityCell, B2bB2cRow, SalesSportRow, SalesTimelineRow, CustomFieldRow, CampaignSummaryRow, TopCampaignMap, SalesTopCampaignMap } from "@/lib/meta-ads/leadAnalytics";

function fmtInt(n: number): string {
  return n.toLocaleString("en-IN");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN");
}

function TopCampaignBadge({ campaign }: { campaign: string | undefined }) {
  if (!campaign) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
      <svg className="h-3.5 w-3.5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M10 1l2.39 4.84 5.34.78-3.87 3.77.91 5.32L10 13.27l-4.77 2.44.91-5.32L2.27 6.62l5.34-.78L10 1z" /></svg>
      <span>Top campaign: <b className="text-slate-700 font-medium">{campaign}</b></span>
    </div>
  );
}

// Pivots flat {x, group, value} rows into StackedBarChart's per-x-category
// shape, capping to the topN groups by total value and folding the remainder
// into "Other" — copied verbatim from CrmAnalyticsClient's shared pivot so the
// city×sport stacked bar stacks and colours exactly like the CRM geography/
// products charts.
const STACK_PALETTE = ["#1C6E8C", "#2E7D4F", "#D9822B", "#7FD3A6", "#61A6BF", "#B33A26", "#566268"];
type StackRow = { x: string; [k: string]: string | number };
function stackedSeries(rows: { x: string; group: string; value: number }[], topN: number) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.group, (totals.get(r.group) ?? 0) + r.value);
  const topGroups = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([g]) => g);
  const topSet = new Set(topGroups);
  const hasOther = totals.size > topGroups.length;
  const stackKeys = hasOther ? [...topGroups, "Other"] : topGroups;

  const byX = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const key = topSet.has(r.group) ? r.group : "Other";
    const entry = byX.get(r.x) ?? {};
    entry[key] = (entry[key] ?? 0) + r.value;
    byX.set(r.x, entry);
  }
  const data: StackRow[] = [...byX.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([x, vals]) => ({ x, ...vals }));
  const colorFor = (k: string) => (k === "Other" ? "#94a3b8" : STACK_PALETTE[stackKeys.indexOf(k) % STACK_PALETTE.length]);
  return { data, stackKeys, colorFor };
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="text-xl font-semibold mt-1 font-mono">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

// Type-or-choose filter for a section (datalist-backed), mirroring LeadsTable's
// filter inputs. `options` are the distinct values to offer for autocomplete.
function FilterCombo({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="flex items-center justify-between gap-1 w-44 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-left hover:border-slate-400 transition-colors"
      >
        <span className={value ? "text-slate-900 truncate" : "text-slate-400 truncate"}>
          {value || "Choose…"}
        </span>
        <svg className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg">
          {options.length > 5 && (
            <div className="p-1.5 border-b border-slate-100">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
              />
            </div>
          )}
          <div className="max-h-52 overflow-y-auto py-1">
            {value && (
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50"
              >
                Clear selection
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => { onChange(o); setOpen(false); }}
                  className={`w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 transition-colors ${o === value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700"}`}
                >
                  {o}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadAnalyticsClient({
  byCity,
  sportByCity,
  repeats,
  jobs,
  areas,
  b2bB2c,
  salesSports,
  salesTimelines,
  salesCustom,
  campaigns,
  topCampaigns,
  salesTopCampaigns,
  hasDateFilter,
  range,
}: {
  byCity: LeadCityRow[];
  sportByCity: SportCityCell[];
  repeats: RepeatLeadRow[];
  jobs: JobCityCell[];
  areas: AreaCityCell[];
  b2bB2c: B2bB2cRow[];
  salesSports: SalesSportRow[];
  salesTimelines: SalesTimelineRow[];
  salesCustom: CustomFieldRow[];
  campaigns: CampaignSummaryRow[];
  topCampaigns: TopCampaignMap;
  salesTopCampaigns: SalesTopCampaignMap;
  hasDateFilter: boolean;
  range: DateRange;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Applying a range pushes ?from/?to; the server page re-fetches on the new
  // query string. useTransition keeps the old data visible with a subtle
  // "Updating…" hint instead of blanking the screen.
  function applyRange(next: DateRange) {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/ad-campaigns/lead-analytics?${qs}` : "/ad-campaigns/lead-analytics");
    });
  }

  // --- Per-section filter state (client-side, over the already-fetched data) ---
  const [cityFilter, setCityFilter] = useState("");
  const [sportCityFilter, setSportCityFilter] = useState("");
  const [sportSportFilter, setSportSportFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [jobCityFilter, setJobCityFilter] = useState("");
  const [jobSportFilter, setJobSportFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [areaCityFilter, setAreaCityFilter] = useState("");
  // Each data card shows only its chart/top rows by default; the full itemised
  // list (table, and the rest of the job cards) reveals on "expand".
  const [cityExpanded, setCityExpanded] = useState(false);
  const [sportExpanded, setSportExpanded] = useState(false);
  const [jobsExpanded, setJobsExpanded] = useState(false);
  const [areaExpanded, setAreaExpanded] = useState(false);
  const [repeatExpanded, setRepeatExpanded] = useState(false);
  const JOBS_PREVIEW = 5;

  // Data source toggle: customer form data vs sales follow-up data
  const hasSalesData = b2bB2c.length > 0 || salesSports.length > 0 || salesTimelines.length > 0 || salesCustom.length > 0;
  const [dataSource, setDataSource] = useState<"customer" | "sales">("customer");

  // Per-section overall/by-city view toggle
  const [cityView, setCityView] = useState<"byCity" | "overall">("byCity");
  const [sportView, setSportView] = useState<"byCity" | "overall">("byCity");
  const [areaView, setAreaView] = useState<"byCity" | "overall">("byCity");
  const [jobView, setJobView] = useState<"byCity" | "overall">("byCity");

  // --- Leads by city ---
  // Totals + top city stay GLOBAL (KPI tiles + the share % denominator), so a
  // city filter narrows which rows show without making one city read "100%".
  const totalCityLeads = byCity.reduce((acc, r) => acc + r.count, 0);
  const topCity = byCity[0] ?? null;
  const cq = cityFilter.trim().toLowerCase();
  const byCityF = cq ? byCity.filter((r) => r.city.toLowerCase().includes(cq)) : byCity;
  const cityBars = byCityF.slice(0, 12); // chart caps to top 12; table/export keep all
  const cityDonut = byCityF.slice(0, 8); // donut caps to top 8 for a legible legend
  const cityHeaders = ["City", "Leads", "Share"];
  const cityRows: (string | number)[][] = byCityF.map((r) => [
    r.city,
    r.count,
    totalCityLeads > 0 ? `${Math.round((r.count / totalCityLeads) * 100)}%` : "—",
  ]);

  // --- Sport demand (overall + city × sport) ---
  // Global ranking feeds the KPI tiles + action hint; the section's chart/table
  // use the city+sport-filtered cells.
  const sportTotalsAll = new Map<string, number>();
  for (const c of sportByCity) sportTotalsAll.set(c.sport, (sportTotalsAll.get(c.sport) ?? 0) + c.count);
  const sportRankingAll = [...sportTotalsAll.entries()]
    .map(([sport, count]) => ({ sport, count }))
    .sort((a, b) => b.count - a.count || a.sport.localeCompare(b.sport));
  const topSport = sportRankingAll[0] ?? null;

  const scq = sportCityFilter.trim().toLowerCase();
  const ssq = sportSportFilter.trim().toLowerCase();
  const sportCellsF = sportByCity.filter(
    (c) => (!scq || c.city.toLowerCase().includes(scq)) && (!ssq || c.sport.toLowerCase().includes(ssq)),
  );
  const sportStack = stackedSeries(
    sportCellsF.map((c) => ({ x: c.city, group: c.sport, value: c.count })),
    6,
  );
  const sportHeaders = ["City", "Sport", "Leads"];
  const sportRows: (string | number)[][] = sportCellsF.map((c) => [c.city, c.sport, c.count]);

  // Distinct option lists for the filter comboboxes.
  const citySportCities = [...new Set(sportByCity.map((c) => c.city))];
  const citySportSports = [...new Set(sportByCity.map((c) => c.sport))];

  // --- Jobs (job × city × sport) ---
  const jq = jobFilter.trim().toLowerCase();
  const jcq = jobCityFilter.trim().toLowerCase();
  const jsq = jobSportFilter.trim().toLowerCase();
  const jobCellsF = jobs.filter(
    (c) =>
      (!jq || c.job.toLowerCase().includes(jq)) &&
      (!jcq || c.city.toLowerCase().includes(jcq)) &&
      (!jsq || c.sport.toLowerCase().includes(jsq)),
  );
  // Group filtered cells into a ranked list: each job title with its city + sport split.
  const jobGroups = (() => {
    const m = new Map<
      string,
      { job: string; count: number; cities: Map<string, number>; sports: Map<string, number> }
    >();
    for (const c of jobCellsF) {
      const g = m.get(c.job) ?? { job: c.job, count: 0, cities: new Map(), sports: new Map() };
      g.count += c.count;
      g.cities.set(c.city, (g.cities.get(c.city) ?? 0) + c.count);
      g.sports.set(c.sport, (g.sports.get(c.sport) ?? 0) + c.count);
      m.set(c.job, g);
    }
    return [...m.values()]
      .map((g) => ({
        job: g.job,
        count: g.count,
        cities: [...g.cities.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count),
        sports: [...g.sports.entries()].map(([sport, count]) => ({ sport, count })).sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count || a.job.localeCompare(b.job));
  })();
  const jobLeadTotal = jobCellsF.reduce((a, c) => a + c.count, 0);
  const jobHeaders = ["Job title", "City", "Sport", "Leads"];
  const jobRows: (string | number)[][] = jobCellsF
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((c) => [c.job, c.city, c.sport, c.count]);
  const jobOptions = [...new Set(jobs.map((c) => c.job))];
  const jobCityOptions = [...new Set(jobs.map((c) => c.city))];
  const jobSportOptions = [...new Set(jobs.map((c) => c.sport))];
  const jobOverallRanking = (() => {
    const m = new Map<string, number>();
    for (const c of jobs) m.set(c.job, (m.get(c.job) ?? 0) + c.count);
    return [...m.entries()]
      .map(([job, count]) => ({ job, count }))
      .sort((a, b) => b.count - a.count || a.job.localeCompare(b.job));
  })();

  // --- Area demand (area × city): rank areas within a city, or cities within
  // an area (and vice versa). Choosing an Area flips the ranking to cities. ---
  const aq = areaFilter.trim().toLowerCase();
  const acq = areaCityFilter.trim().toLowerCase();
  const areaCellsF = areas.filter(
    (c) => (!aq || c.area.toLowerCase().includes(aq)) && (!acq || c.city.toLowerCase().includes(acq)),
  );
  const areaGroupBy: "city" | "area" = areaFilter ? "city" : "area";
  const areaRanking = (() => {
    const m = new Map<string, number>();
    for (const c of areaCellsF) m.set(c[areaGroupBy], (m.get(c[areaGroupBy]) ?? 0) + c.count);
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  })();
  const areaBars = areaRanking.slice(0, 12);
  const areaLeadTotal = areaCellsF.reduce((a, c) => a + c.count, 0);
  const areaHeaders = ["Area", "City", "Leads"];
  const areaRows: (string | number)[][] = areaCellsF
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((c) => [c.area, c.city, c.count]);
  const areaOptions = [...new Set(areas.map((c) => c.area))];
  const areaCityOptions = [...new Set(areas.map((c) => c.city))];

  // --- Overall area ranking (without city dimension) ---
  const areaOverallRanking = (() => {
    const m = new Map<string, number>();
    for (const c of areas) m.set(c.area, (m.get(c.area) ?? 0) + c.count);
    return [...m.entries()]
      .map(([area, count]) => ({ label: area, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  })();

  // --- Repeat submitters ---
  const repeatHeaders = ["Person", "Phone", "Campaigns", "Which campaigns", "First seen", "Last seen"];
  const repeatRows: (string | number)[][] = repeats.map((r) => [
    r.name ?? "—",
    r.phone ?? "—",
    r.campaignCount,
    [...new Set(r.campaigns.map((c) => c.campaignName ?? "(unattributed)"))].join(", "),
    fmtDate(r.firstAt),
    fmtDate(r.lastAt),
  ]);

  // --- Sales data totals ---
  const totalB2bB2c = b2bB2c.reduce((a, r) => a + r.count, 0);
  const totalSalesSports = salesSports.reduce((a, r) => a + r.count, 0);

  const hasAnyData = byCity.length > 0 || sportByCity.length > 0 || repeats.length > 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        large
        title="Lead Analytics"
        description="Where your Meta lead-form submissions are coming from — leads by city, sport demand per city, and people who keep coming back — over the selected range."
        action={<DateRangePicker value={range} onApply={applyRange} />}
      />

      <div className={`mt-4 space-y-4 ${pending ? "opacity-60 transition-opacity" : ""}`}>
        {pending && <div className="text-xs text-slate-400">Updating…</div>}

        {!hasAnyData && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
            No lead-form data in this range yet. Leads flow in from the{" "}
            <Link href="/ad-campaigns" className="font-medium underline">
              Ad Campaigns
            </Link>{" "}
            Instant Forms as they&apos;re submitted; city and sport are read off each form&apos;s answers.
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile label="Leads (with location)" value={fmtInt(totalCityLeads)} sub="Instant-Form submissions" />
          <KpiTile label="Cities" value={fmtInt(byCity.length)} sub={topCity ? `Top: ${topCity.city}` : "No city data"} />
          <KpiTile label="Sports asked for" value={fmtInt(sportRankingAll.length)} sub={topSport ? `Top: ${topSport.sport}` : "No sport data"} />
          <KpiTile
            label="Repeat submitters"
            value={fmtInt(repeats.length)}
            sub="Across >1 campaign"
          />
        </div>

        {/* Campaign summary (visible when date filter is active) */}
        {hasDateFilter && campaigns.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-heading font-bold uppercase tracking-wide text-slate-500 mb-2">Campaigns in this period</div>
            <div className="flex flex-wrap gap-2">
              {campaigns.map((c) => (
                <div key={c.campaignName} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                  <span className="text-sm font-medium text-slate-800 truncate max-w-[200px]">{c.campaignName}</span>
                  <span className="rounded-full bg-court-100 px-2 py-0.5 text-xs font-mono font-semibold text-court-700">{fmtInt(c.leadCount)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}, {fmtInt(campaigns.reduce((a, c) => a + c.leadCount, 0))} total leads</p>
          </div>
        )}

        {/* Ask AI — freeform questions + recommendations, answered only from the real lead data */}
        <MetaAiSummary />

        {/* Data source toggle — always visible so the feature is discoverable */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
          <button
            type="button"
            onClick={() => setDataSource("customer")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${dataSource === "customer" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            Customer data
          </button>
          <button
            type="button"
            onClick={() => setDataSource("sales")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${dataSource === "sales" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            Sales follow-up data
          </button>
        </div>

        {/* ═══ CUSTOMER DATA SECTIONS ═══ */}
        {dataSource === "customer" && (<>

        {/* Leads by city */}
        <AnalyticsCard
          title={cityView === "overall" ? "Total leads (overall)" : "Leads by city"}
          description={`${cityView === "overall" ? "Overall lead volume across all cities." : "Every lead's city, ranked by volume — where the demand is coming from."}${totalCityLeads > 0 ? ` Overall: ${fmtInt(totalCityLeads)} leads across ${byCity.length} cities.` : ""}`}
          action={topCity ? `Most leads are coming from ${topCity.city} (${fmtInt(topCity.count)}) — prioritise follow-up and local offers there.` : undefined}
        >
          {byCity.length === 0 ? (
            <p className="text-sm text-slate-400">No location data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit">
                <button type="button" onClick={() => setCityView("byCity")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${cityView === "byCity" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>By city</button>
                <button type="button" onClick={() => setCityView("overall")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${cityView === "overall" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>Overall</button>
              </div>
              <TopCampaignBadge campaign={topCampaigns.overall ?? undefined} />

              {cityView === "overall" ? (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <div className="heading text-xs tracking-wide text-slate-500 mb-2">All cities ranked</div>
                      <HorizontalBarChart
                        data={byCity.slice(0, 12)}
                        dataKey="count"
                        labelKey="city"
                        height={Math.max(140, Math.min(byCity.length, 12) * 34)}
                        colorFor={() => "#1C6E8C"}
                        tooltipFormatter={(d) => `${d.city}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                      />
                    </div>
                    <div>
                      <div className="heading text-xs tracking-wide text-slate-500 mb-2">Share of leads</div>
                      <DonutChart
                        data={byCity.slice(0, 8)}
                        dataKey="count"
                        labelKey="city"
                        colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
                        tooltipFormatter={(r) =>
                          `${r.city}: ${fmtInt(r.count)} (${totalCityLeads > 0 ? Math.round((r.count / totalCityLeads) * 100) : 0}%)`
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setCityExpanded((v) => !v)} className="text-sm font-medium text-court-700 hover:underline">
                      {cityExpanded ? "Show less ▲" : `Show full list (${cityRows.length}) ▼`}
                    </button>
                    <ExportButtons filename="leads-by-city" headers={cityHeaders} rows={cityRows} />
                  </div>
                  {cityExpanded && <DataTable headers={cityHeaders} rows={cityRows} />}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <FilterCombo id="la-city" label="City" value={cityFilter} onChange={setCityFilter} options={byCity.map((r) => r.city)} />
                    <div className="text-xs text-slate-500 pb-1.5">
                      Showing <b className="text-slate-800 font-mono">{byCityF.length}</b> of {byCity.length} cities
                      {cq && <span className="text-slate-400"> (filtered)</span>}
                    </div>
                    {cityFilter && (
                      <button type="button" onClick={() => setCityFilter("")} className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5">Clear</button>
                    )}
                  </div>
                  {byCityF.length === 0 ? (
                    <p className="text-sm text-slate-400">No cities match "{cityFilter}".</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div>
                          <div className="heading text-xs tracking-wide text-slate-500 mb-2">Top cities</div>
                          <HorizontalBarChart
                            data={cityBars}
                            dataKey="count"
                            labelKey="city"
                            height={Math.max(140, cityBars.length * 34)}
                            colorFor={() => "#1C6E8C"}
                            tooltipFormatter={(d) => `${d.city}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                          />
                        </div>
                        <div>
                          <div className="heading text-xs tracking-wide text-slate-500 mb-2">Share of leads</div>
                          <DonutChart
                            data={cityDonut}
                            dataKey="count"
                            labelKey="city"
                            colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
                            tooltipFormatter={(r) =>
                              `${r.city}: ${fmtInt(r.count)} (${totalCityLeads > 0 ? Math.round((r.count / totalCityLeads) * 100) : 0}%)`
                            }
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" onClick={() => setCityExpanded((v) => !v)} className="text-sm font-medium text-court-700 hover:underline">
                          {cityExpanded ? "Show less ▲" : `Show full list (${cityRows.length}) ▼`}
                        </button>
                        <ExportButtons filename="leads-by-city" headers={cityHeaders} rows={cityRows} />
                      </div>
                      {cityExpanded && <DataTable headers={cityHeaders} rows={cityRows} />}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </AnalyticsCard>

        {/* Sport demand */}
        <AnalyticsCard
          title={sportView === "overall" ? "Most-requested sport (overall)" : "Most-requested sport per city"}
          description={`${sportView === "overall" ? "Overall sport demand across all cities." : "What each city is asking for — leads by sport."}${sportRankingAll.length > 0 ? ` Overall: ${fmtInt(sportByCity.reduce((a, c) => a + c.count, 0))} leads across ${sportRankingAll.length} sports.` : ""}`}
          action={topSport ? `${topSport.sport} is the most-requested interest (${fmtInt(topSport.count)} lead${topSport.count === 1 ? "" : "s"}) — feature it in your next campaign.` : undefined}
        >
          {sportByCity.length === 0 ? (
            <p className="text-sm text-slate-400">No sport data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit">
                <button type="button" onClick={() => setSportView("byCity")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${sportView === "byCity" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>By city</button>
                <button type="button" onClick={() => setSportView("overall")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${sportView === "overall" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>Overall</button>
              </div>
              {topSport && <TopCampaignBadge campaign={topCampaigns.bySport[topSport.sport]} />}

              {sportView === "overall" ? (
                <>
                  <HorizontalBarChart
                    data={sportRankingAll.slice(0, 12)}
                    dataKey="count"
                    labelKey="sport"
                    height={Math.max(140, Math.min(sportRankingAll.length, 12) * 34)}
                    colorFor={() => "#1C6E8C"}
                    tooltipFormatter={(d) => `${d.sport}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                  />
                  <DonutChart
                    data={sportRankingAll.slice(0, 8)}
                    dataKey="count"
                    labelKey="sport"
                    colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
                    tooltipFormatter={(r) => `${r.sport}: ${fmtInt(r.count)}`}
                  />
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <FilterCombo id="la-sport-city" label="City" value={sportCityFilter} onChange={setSportCityFilter} options={citySportCities} />
                    <FilterCombo id="la-sport-sport" label="Sport" value={sportSportFilter} onChange={setSportSportFilter} options={citySportSports} />
                    <div className="text-xs text-slate-500 pb-1.5">
                      <b className="text-slate-800 font-mono">{sportCellsF.reduce((a, c) => a + c.count, 0)}</b> leads
                      {(scq || ssq) && <span className="text-slate-400"> (filtered)</span>}
                    </div>
                    {(sportCityFilter || sportSportFilter) && (
                      <button type="button" onClick={() => { setSportCityFilter(""); setSportSportFilter(""); }} className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5">Clear</button>
                    )}
                  </div>
                  {sportCellsF.length === 0 ? (
                    <p className="text-sm text-slate-400">No leads match the current filters.</p>
                  ) : (
                    <>
                      <StackedBarChart
                        data={sportStack.data}
                        dataKey="x"
                        stackKeys={sportStack.stackKeys}
                        height={280}
                        colorFor={sportStack.colorFor}
                        tooltipFormatter={(d) =>
                          `${d.x} · ${sportStack.stackKeys
                            .filter((k) => Number(d[k] ?? 0) > 0)
                            .map((k) => `${k}: ${fmtInt(Number(d[k] ?? 0))}`)
                            .join(" · ")}`
                        }
                      />
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" onClick={() => setSportExpanded((v) => !v)} className="text-sm font-medium text-court-700 hover:underline">
                          {sportExpanded ? "Show less ▲" : `Show full list (${sportRows.length}) ▼`}
                        </button>
                        <ExportButtons filename="sport-by-city" headers={sportHeaders} rows={sportRows} />
                      </div>
                      {sportExpanded && <DataTable headers={sportHeaders} rows={sportRows} />}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </AnalyticsCard>

        {/* Area demand */}
        <AnalyticsCard
          title={areaView === "overall" ? "Area demand (overall)" : "Area demand by city"}
          description={`${areaView === "overall" ? "Overall area-size demand across all cities." : "How much space leads are asking for (the form's area-in-sq.ft answer)."}${areas.length > 0 ? ` Overall: ${fmtInt(areas.reduce((a, c) => a + c.count, 0))} leads across ${new Set(areas.map(a => a.area)).size} area sizes.` : ""}`}
        >
          {areas.length === 0 ? (
            <p className="text-sm text-slate-400">No area-size data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit">
                <button type="button" onClick={() => setAreaView("byCity")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${areaView === "byCity" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>By city</button>
                <button type="button" onClick={() => setAreaView("overall")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${areaView === "overall" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>Overall</button>
              </div>
              {areaOverallRanking[0] && <TopCampaignBadge campaign={topCampaigns.byArea[areaOverallRanking[0].label]} />}

              {areaView === "overall" ? (
                <>
                  <HorizontalBarChart
                    data={areaOverallRanking.slice(0, 12)}
                    dataKey="count"
                    labelKey="label"
                    height={Math.max(140, Math.min(areaOverallRanking.length, 12) * 34)}
                    colorFor={() => "#1C6E8C"}
                    tooltipFormatter={(d) => `${d.label}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                  />
                  <DonutChart
                    data={areaOverallRanking.slice(0, 8)}
                    dataKey="count"
                    labelKey="label"
                    colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
                    tooltipFormatter={(r) => `${r.label}: ${fmtInt(r.count)}`}
                  />
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <FilterCombo id="la-area-city" label="City" value={areaCityFilter} onChange={setAreaCityFilter} options={areaCityOptions} />
                    <FilterCombo id="la-area" label="Area" value={areaFilter} onChange={setAreaFilter} options={areaOptions} />
                    <div className="text-xs text-slate-500 pb-1.5">
                      <b className="text-slate-800 font-mono">{areaLeadTotal}</b> leads
                      {(aq || acq) && <span className="text-slate-400"> (filtered)</span>}
                    </div>
                    {(areaFilter || areaCityFilter) && (
                      <button type="button" onClick={() => { setAreaFilter(""); setAreaCityFilter(""); }} className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5">Clear</button>
                    )}
                  </div>
                  {areaRanking.length === 0 ? (
                    <p className="text-sm text-slate-400">No leads match the current filters.</p>
                  ) : (
                    <>
                      <div>
                        <div className="heading text-xs tracking-wide text-slate-500 mb-2">
                          {areaFilter
                            ? "Cities requesting this area (most to least)"
                            : areaCityFilter
                              ? "Area sizes requested in this city (most to least)"
                              : "Area sizes requested (most to least)"}
                        </div>
                        <HorizontalBarChart
                          data={areaBars}
                          dataKey="count"
                          labelKey="label"
                          height={Math.max(140, areaBars.length * 34)}
                          colorFor={() => "#1C6E8C"}
                          tooltipFormatter={(d) => `${d.label}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" onClick={() => setAreaExpanded((v) => !v)} className="text-sm font-medium text-court-700 hover:underline">
                          {areaExpanded ? "Show less ▲" : `Show full list (${areaRows.length}) ▼`}
                        </button>
                        <ExportButtons filename="area-by-city" headers={areaHeaders} rows={areaRows} />
                      </div>
                      {areaExpanded && <DataTable headers={areaHeaders} rows={areaRows} />}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </AnalyticsCard>

        {/* Jobs — who's asking */}
        <AnalyticsCard
          title={jobView === "overall" ? "Jobs — who's asking (overall)" : "Jobs — who's asking"}
          description={`${jobView === "overall" ? "Overall job title demand across all cities." : "What people do for a living (from the form's job-title answer)."}${jobs.length > 0 ? ` Overall: ${fmtInt(jobs.reduce((a, c) => a + c.count, 0))} leads across ${new Set(jobs.map(j => j.job)).size} job titles.` : ""}`}
        >
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-400">No job-title data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit">
                <button type="button" onClick={() => setJobView("byCity")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${jobView === "byCity" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>By city</button>
                <button type="button" onClick={() => setJobView("overall")} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${jobView === "overall" ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>Overall</button>
              </div>
              {jobOverallRanking[0] && <TopCampaignBadge campaign={topCampaigns.byJob[jobOverallRanking[0].job]} />}

              {jobView === "overall" ? (
                <>
                  <HorizontalBarChart
                    data={jobOverallRanking.slice(0, 12)}
                    dataKey="count"
                    labelKey="job"
                    height={Math.max(140, Math.min(jobOverallRanking.length, 12) * 34)}
                    colorFor={() => "#1C6E8C"}
                    tooltipFormatter={(d) => `${d.job}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                  />
                  <DonutChart
                    data={jobOverallRanking.slice(0, 8)}
                    dataKey="count"
                    labelKey="job"
                    colorFor={(_r, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]}
                    tooltipFormatter={(r) => `${r.job}: ${fmtInt(r.count)}`}
                  />
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <FilterCombo id="la-job" label="Job title" value={jobFilter} onChange={setJobFilter} options={jobOptions} />
                    <FilterCombo id="la-job-city" label="City" value={jobCityFilter} onChange={setJobCityFilter} options={jobCityOptions} />
                    <FilterCombo id="la-job-sport" label="Sport" value={jobSportFilter} onChange={setJobSportFilter} options={jobSportOptions} />
                    <div className="text-xs text-slate-500 pb-1.5">
                      <b className="text-slate-800 font-mono">{jobLeadTotal}</b> leads · {jobGroups.length} job{jobGroups.length === 1 ? "" : "s"}
                      {(jq || jcq || jsq) && <span className="text-slate-400"> (filtered)</span>}
                    </div>
                    {(jobFilter || jobCityFilter || jobSportFilter) && (
                      <button type="button" onClick={() => { setJobFilter(""); setJobCityFilter(""); setJobSportFilter(""); }} className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5">Clear</button>
                    )}
                  </div>
                  {jobGroups.length === 0 ? (
                    <p className="text-sm text-slate-400">No leads match the current filters.</p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {(jobsExpanded ? jobGroups : jobGroups.slice(0, JOBS_PREVIEW)).map((g, i) => (
                          <div key={g.job} className="card p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="font-medium text-slate-900 break-words">
                                <span className="text-slate-400 font-mono mr-1.5">{i + 1}.</span>
                                {g.job}
                              </div>
                              <div className="shrink-0 text-right leading-tight">
                                <div className="text-lg font-semibold text-slate-900 font-mono">{fmtInt(g.count)}</div>
                                <div className="text-xs text-slate-400">leads</div>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="heading text-xs tracking-wide text-slate-400 mr-1">Cities</span>
                              {g.cities.map((c) => (
                                <span key={c.city} className="chip">
                                  {c.city} <span className="text-slate-400 font-mono">{c.count}</span>
                                </span>
                              ))}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="heading text-xs tracking-wide text-slate-400 mr-1">Sports</span>
                              {g.sports.map((s) => (
                                <span key={s.sport} className="chip bg-court-50 border-court-200 text-court-700">
                                  {s.sport} <span className="text-court-500 font-mono">{s.count}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" onClick={() => setJobsExpanded((v) => !v)} className="text-sm font-medium text-court-700 hover:underline">
                          {jobsExpanded ? "Show less ▲" : `Show all ${jobGroups.length} jobs ▼`}
                        </button>
                        <ExportButtons filename="leads-by-job" headers={jobHeaders} rows={jobRows} />
                      </div>
                      {jobsExpanded && <DataTable headers={jobHeaders} rows={jobRows} />}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </AnalyticsCard>

        {/* Repeat submitters */}
        <AnalyticsCard
          title="Repeat submitters"
          description="People who submitted a lead form across more than one campaign (deduped by phone, else email) — warm contacts who keep coming back."
          action={
            repeats.length > 0
              ? `${fmtInt(repeats.length)} ${repeats.length === 1 ? "person has" : "people have"} submitted across multiple campaigns — reach out directly, they're already engaged.`
              : undefined
          }
        >
          {repeats.length === 0 ? (
            <p className="text-sm text-slate-400">No repeat submitters in this range — nobody has appeared across more than one campaign yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setRepeatExpanded((v) => !v)} className="text-sm font-medium text-court-700 hover:underline">
                  {repeatExpanded ? "Show less ▲" : `Show all ${repeatRows.length} ▼`}
                </button>
                <ExportButtons filename="repeat-leads" headers={repeatHeaders} rows={repeatRows} />
              </div>
              <DataTable headers={repeatHeaders} rows={repeatExpanded ? repeatRows : repeatRows.slice(0, 5)} />
            </div>
          )}
        </AnalyticsCard>

        </>)}

        {/* ═══ SALES DATA SECTIONS ═══ */}
        {dataSource === "sales" && (<>
          {!hasSalesData ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
              No sales follow-up data entered yet. Open a lead&apos;s sidebar (stage must be Contacted or later) and fill in the Sales follow-up form.
            </div>
          ) : (<>


            {/* B2B / B2C */}
            {b2bB2c.length > 0 && (
              <AnalyticsCard
                title="B2B / B2C split"
                description={`Lead classification by sales reps. Overall: ${fmtInt(totalB2bB2c)} leads classified.`}
              >
                <div className="space-y-3">
                  {b2bB2c[0] && <TopCampaignBadge campaign={salesTopCampaigns.byB2bB2c[b2bB2c[0].type]} />}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {b2bB2c.map((r) => (
                      <div key={r.type} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                        <div className="text-lg font-semibold font-mono text-slate-900">{fmtInt(r.count)}</div>
                        <div className="text-sm font-medium text-slate-600">{r.type}</div>
                        <div className="text-xs text-slate-400">{totalB2bB2c > 0 ? `${Math.round((r.count / totalB2bB2c) * 100)}%` : "—"}</div>
                      </div>
                    ))}
                  </div>
                  <DonutChart
                    data={b2bB2c}
                    dataKey="count"
                    labelKey="type"
                    height={180}
                    colorFor={(_r, i) => i === 0 ? "#1C6E8C" : "#2E7D4F"}
                    tooltipFormatter={(r) => `${r.type}: ${fmtInt(r.count)} (${totalB2bB2c > 0 ? Math.round((r.count / totalB2bB2c) * 100) : 0}%)`}
                  />
                </div>
              </AnalyticsCard>
            )}

            {/* Sales-entered sport */}
            {salesSports.length > 0 && (
              <AnalyticsCard
                title="Sport (sales-entered)"
                description={`Sport confirmed by sales reps during follow-up. Overall: ${fmtInt(totalSalesSports)} leads.`}
              >
                {salesSports[0] && <TopCampaignBadge campaign={salesTopCampaigns.bySport[salesSports[0].sport]} />}
                <HorizontalBarChart
                  data={salesSports.slice(0, 10)}
                  dataKey="count"
                  labelKey="sport"
                  height={Math.max(140, Math.min(salesSports.length, 10) * 34)}
                  colorFor={() => "#2E7D4F"}
                  tooltipFormatter={(d) => `${d.sport}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                />
              </AnalyticsCard>
            )}

            {/* Build timeline */}
            {salesTimelines.length > 0 && (
              <AnalyticsCard
                title="Build timeline"
                description={`When leads plan to start the build (sales-entered). Overall: ${fmtInt(salesTimelines.reduce((a, r) => a + r.count, 0))} leads.`}
              >
                {salesTimelines[0] && <TopCampaignBadge campaign={salesTopCampaigns.byTimeline[salesTimelines[0].timeline]} />}
                <HorizontalBarChart
                  data={salesTimelines.slice(0, 10)}
                  dataKey="count"
                  labelKey="timeline"
                  height={Math.max(140, Math.min(salesTimelines.length, 10) * 34)}
                  colorFor={() => "#D9822B"}
                  tooltipFormatter={(d) => `${d.timeline}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                />
              </AnalyticsCard>
            )}

            {/* Custom fields */}
            {salesCustom.length > 0 && (
              <AnalyticsCard
                title="Custom fields"
                description="Additional data points entered by sales reps. Grouped by field name and value."
              >
                <div className="space-y-2">
                  {(() => {
                    const byField = new Map<string, { value: string; count: number }[]>();
                    for (const c of salesCustom) {
                      const arr = byField.get(c.field) ?? [];
                      arr.push({ value: c.value, count: c.count });
                      byField.set(c.field, arr);
                    }
                    return [...byField.entries()].map(([field, values]) => (
                      <div key={field} className="rounded-lg border border-slate-200 p-3">
                        <div className="text-sm font-semibold text-slate-700 mb-2">{field}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {values.map((v) => (
                            <span key={v.value} className="chip">
                              {v.value} <span className="text-slate-400 font-mono">{v.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </AnalyticsCard>
            )}
          </>)}
        </>)}
      </div>
    </div>
  );
}
