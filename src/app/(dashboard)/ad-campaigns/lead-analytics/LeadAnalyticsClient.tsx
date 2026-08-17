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

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { DataTable } from "@/components/analytics/DataTable";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { HorizontalBarChart, StackedBarChart, DonutChart, DONUT_PALETTE } from "@/components/analytics/charts";
import MetaAiSummary from "@/components/MetaAiSummary";
import type { LeadCityRow, SportCityCell, RepeatLeadRow, JobCityCell, AreaCityCell } from "@/lib/meta-ads/leadAnalytics";

function fmtInt(n: number): string {
  return n.toLocaleString("en-IN");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN");
}

// Pivots flat {x, group, value} rows into StackedBarChart's per-x-category
// shape, capping to the topN groups by total value and folding the remainder
// into "Other" — copied verbatim from CrmAnalyticsClient's shared pivot so the
// city×sport stacked bar stacks and colours exactly like the CRM geography/
// products charts.
const STACK_PALETTE = ["#25D366", "#73caf0", "#fbbf24", "#c81124", "#a78bfa", "#34d399", "#f472b6"];
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
      <div className="text-xl font-semibold mt-1">{value}</div>
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
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type or choose…"
        className="w-44 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green/30"
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}

export default function LeadAnalyticsClient({
  byCity,
  sportByCity,
  repeats,
  jobs,
  areas,
  range,
}: {
  byCity: LeadCityRow[];
  sportByCity: SportCityCell[];
  repeats: RepeatLeadRow[];
  jobs: JobCityCell[];
  areas: AreaCityCell[];
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

        {/* Ask AI — freeform questions + recommendations, answered only from the real lead data */}
        <MetaAiSummary />

        {/* Leads by city */}
        <AnalyticsCard
          title="Leads by city"
          description="Every lead's city, ranked by volume — where the demand is actually coming from. Chart shows the top cities; the table lists them all."
          action={topCity ? `Most leads are coming from ${topCity.city} (${fmtInt(topCity.count)}) — prioritise follow-up and local offers there.` : undefined}
        >
          {byCity.length === 0 ? (
            <p className="text-sm text-slate-400">No location data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <FilterCombo id="la-city" label="City" value={cityFilter} onChange={setCityFilter} options={byCity.map((r) => r.city)} />
                <div className="text-xs text-slate-500 pb-1.5">
                  Showing <b className="text-slate-800">{byCityF.length}</b> of {byCity.length} cities
                  {cq && <span className="text-slate-400"> (filtered)</span>}
                </div>
                {cityFilter && (
                  <button type="button" onClick={() => setCityFilter("")} className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5">
                    Clear
                  </button>
                )}
              </div>
              {byCityF.length === 0 ? (
                <p className="text-sm text-slate-400">No cities match “{cityFilter}”.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Top cities</div>
                      <HorizontalBarChart
                        data={cityBars}
                        dataKey="count"
                        labelKey="city"
                        height={Math.max(140, cityBars.length * 34)}
                        colorFor={() => "#159341"}
                        tooltipFormatter={(d) => `${d.city}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                      />
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Share of leads</div>
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
                    <button type="button" onClick={() => setCityExpanded((v) => !v)} className="text-sm font-medium text-wa-dark hover:underline">
                      {cityExpanded ? "Show less ▲" : `Show full list (${cityRows.length}) ▼`}
                    </button>
                    <ExportButtons filename="leads-by-city" headers={cityHeaders} rows={cityRows} />
                  </div>
                  {cityExpanded && <DataTable headers={cityHeaders} rows={cityRows} />}
                </>
              )}
            </div>
          )}
        </AnalyticsCard>

        {/* Sport demand per city */}
        <AnalyticsCard
          title="Most-requested sport per city"
          description="What each city is asking for — leads split by the sport/interest they selected on the form. Top 6 sports shown, the rest folded into Other."
          action={topSport ? `${topSport.sport} is the most-requested interest (${fmtInt(topSport.count)} lead${topSport.count === 1 ? "" : "s"}) — feature it in your next campaign.` : undefined}
        >
          {sportByCity.length === 0 ? (
            <p className="text-sm text-slate-400">No sport data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <FilterCombo id="la-sport-city" label="City" value={sportCityFilter} onChange={setSportCityFilter} options={citySportCities} />
                <FilterCombo id="la-sport-sport" label="Sport" value={sportSportFilter} onChange={setSportSportFilter} options={citySportSports} />
                <div className="text-xs text-slate-500 pb-1.5">
                  <b className="text-slate-800">{sportCellsF.reduce((a, c) => a + c.count, 0)}</b> leads
                  {(scq || ssq) && <span className="text-slate-400"> (filtered)</span>}
                </div>
                {(sportCityFilter || sportSportFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSportCityFilter("");
                      setSportSportFilter("");
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5"
                  >
                    Clear
                  </button>
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
                    <button type="button" onClick={() => setSportExpanded((v) => !v)} className="text-sm font-medium text-wa-dark hover:underline">
                      {sportExpanded ? "Show less ▲" : `Show full list (${sportRows.length}) ▼`}
                    </button>
                    <ExportButtons filename="sport-by-city" headers={sportHeaders} rows={sportRows} />
                  </div>
                  {sportExpanded && <DataTable headers={sportHeaders} rows={sportRows} />}
                </>
              )}
            </div>
          )}
        </AnalyticsCard>

        {/* Area demand (area × city) — rank areas in a city, or cities for an area */}
        <AnalyticsCard
          title="Area demand by city"
          description="How much space leads are asking for (the form's area-in-sq.ft answer). Pick a city to rank its area sizes most-to-least, or pick an area to see which cities want it most — and vice versa."
        >
          {areas.length === 0 ? (
            <p className="text-sm text-slate-400">No area-size data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <FilterCombo id="la-area-city" label="City" value={areaCityFilter} onChange={setAreaCityFilter} options={areaCityOptions} />
                <FilterCombo id="la-area" label="Area" value={areaFilter} onChange={setAreaFilter} options={areaOptions} />
                <div className="text-xs text-slate-500 pb-1.5">
                  <b className="text-slate-800">{areaLeadTotal}</b> leads
                  {(aq || acq) && <span className="text-slate-400"> (filtered)</span>}
                </div>
                {(areaFilter || areaCityFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAreaFilter("");
                      setAreaCityFilter("");
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5"
                  >
                    Clear
                  </button>
                )}
              </div>
              {areaRanking.length === 0 ? (
                <p className="text-sm text-slate-400">No leads match the current filters.</p>
              ) : (
                <>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
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
                      colorFor={() => "#159341"}
                      tooltipFormatter={(d) => `${d.label}: ${fmtInt(d.count)} lead${d.count === 1 ? "" : "s"}`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setAreaExpanded((v) => !v)} className="text-sm font-medium text-wa-dark hover:underline">
                      {areaExpanded ? "Show less ▲" : `Show full list (${areaRows.length}) ▼`}
                    </button>
                    <ExportButtons filename="area-by-city" headers={areaHeaders} rows={areaRows} />
                  </div>
                  {areaExpanded && <DataTable headers={areaHeaders} rows={areaRows} />}
                </>
              )}
            </div>
          )}
        </AnalyticsCard>

        {/* Jobs — who's asking (job title × city × sport, all in one) */}
        <AnalyticsCard
          title="Jobs — who's asking"
          description="What people do for a living (from the form's job-title answer) and the cities and sports each job is asking for — all in one. Filter by job, city, or sport."
        >
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-400">No job-title data in this range yet.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <FilterCombo id="la-job" label="Job title" value={jobFilter} onChange={setJobFilter} options={jobOptions} />
                <FilterCombo id="la-job-city" label="City" value={jobCityFilter} onChange={setJobCityFilter} options={jobCityOptions} />
                <FilterCombo id="la-job-sport" label="Sport" value={jobSportFilter} onChange={setJobSportFilter} options={jobSportOptions} />
                <div className="text-xs text-slate-500 pb-1.5">
                  <b className="text-slate-800">{jobLeadTotal}</b> leads · {jobGroups.length} job{jobGroups.length === 1 ? "" : "s"}
                  {(jq || jcq || jsq) && <span className="text-slate-400"> (filtered)</span>}
                </div>
                {(jobFilter || jobCityFilter || jobSportFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setJobFilter("");
                      setJobCityFilter("");
                      setJobSportFilter("");
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5"
                  >
                    Clear
                  </button>
                )}
              </div>
              {jobGroups.length === 0 ? (
                <p className="text-sm text-slate-400">No leads match the current filters.</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {(jobsExpanded ? jobGroups : jobGroups.slice(0, JOBS_PREVIEW)).map((g, i) => (
                      <div key={g.job} className="border border-slate-200 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-medium text-slate-900 break-words">
                            <span className="text-slate-400 tabular-nums mr-1.5">{i + 1}.</span>
                            {g.job}
                          </div>
                          <div className="shrink-0 text-right leading-tight">
                            <div className="text-lg font-semibold text-slate-900 tabular-nums">{fmtInt(g.count)}</div>
                            <div className="text-xs text-slate-400">leads</div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 mr-1">Cities</span>
                          {g.cities.map((c) => (
                            <span key={c.city} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {c.city} <span className="text-slate-400 tabular-nums">{c.count}</span>
                            </span>
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 mr-1">Sports</span>
                          {g.sports.map((s) => (
                            <span key={s.sport} className="text-xs px-2 py-0.5 rounded-full bg-wa-green/10 text-wa-dark">
                              {s.sport} <span className="text-slate-500 tabular-nums">{s.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setJobsExpanded((v) => !v)} className="text-sm font-medium text-wa-dark hover:underline">
                      {jobsExpanded ? "Show less ▲" : `Show all ${jobGroups.length} jobs ▼`}
                    </button>
                    <ExportButtons filename="leads-by-job" headers={jobHeaders} rows={jobRows} />
                  </div>
                  {jobsExpanded && <DataTable headers={jobHeaders} rows={jobRows} />}
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
                <button type="button" onClick={() => setRepeatExpanded((v) => !v)} className="text-sm font-medium text-wa-dark hover:underline">
                  {repeatExpanded ? "Show less ▲" : `Show all ${repeatRows.length} ▼`}
                </button>
                <ExportButtons filename="repeat-leads" headers={repeatHeaders} rows={repeatRows} />
              </div>
              <DataTable headers={repeatHeaders} rows={repeatExpanded ? repeatRows : repeatRows.slice(0, 5)} />
            </div>
          )}
        </AnalyticsCard>
      </div>
    </div>
  );
}
