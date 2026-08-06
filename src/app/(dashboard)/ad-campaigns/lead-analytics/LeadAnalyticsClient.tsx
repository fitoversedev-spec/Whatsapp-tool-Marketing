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

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { DataTable } from "@/components/analytics/DataTable";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { HorizontalBarChart, StackedBarChart, DonutChart, DONUT_PALETTE } from "@/components/analytics/charts";
import MetaAiSummary from "@/components/MetaAiSummary";
import type { LeadCityRow, SportCityCell, RepeatLeadRow } from "@/lib/meta-ads/leadAnalytics";

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

export default function LeadAnalyticsClient({
  byCity,
  sportByCity,
  repeats,
  range,
}: {
  byCity: LeadCityRow[];
  sportByCity: SportCityCell[];
  repeats: RepeatLeadRow[];
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

  // --- Leads by city ---
  const totalCityLeads = byCity.reduce((acc, r) => acc + r.count, 0);
  const topCity = byCity[0] ?? null;
  const cityBars = byCity.slice(0, 12); // chart caps to top 12; table/export keep all
  const cityDonut = byCity.slice(0, 8); // donut caps to top 8 for a legible legend
  const cityHeaders = ["City", "Leads", "Share"];
  const cityRows: (string | number)[][] = byCity.map((r) => [
    r.city,
    r.count,
    totalCityLeads > 0 ? `${Math.round((r.count / totalCityLeads) * 100)}%` : "—",
  ]);

  // --- Sport demand (overall + city × sport) ---
  const sportTotals = new Map<string, number>();
  for (const c of sportByCity) sportTotals.set(c.sport, (sportTotals.get(c.sport) ?? 0) + c.count);
  const sportRanking = [...sportTotals.entries()]
    .map(([sport, count]) => ({ sport, count }))
    .sort((a, b) => b.count - a.count || a.sport.localeCompare(b.sport));
  const topSport = sportRanking[0] ?? null;
  const sportStack = stackedSeries(
    sportByCity.map((c) => ({ x: c.city, group: c.sport, value: c.count })),
    6,
  );
  const sportHeaders = ["City", "Sport", "Leads"];
  const sportRows: (string | number)[][] = sportByCity.map((c) => [c.city, c.sport, c.count]);

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
          <KpiTile label="Sports asked for" value={fmtInt(sportRanking.length)} sub={topSport ? `Top: ${topSport.sport}` : "No sport data"} />
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
              <div className="flex justify-end">
                <ExportButtons filename="leads-by-city" headers={cityHeaders} rows={cityRows} />
              </div>
              <DataTable headers={cityHeaders} rows={cityRows} />
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
              <div className="flex justify-end">
                <ExportButtons filename="sport-by-city" headers={sportHeaders} rows={sportRows} />
              </div>
              <DataTable headers={sportHeaders} rows={sportRows} />
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
              <div className="flex justify-end">
                <ExportButtons filename="repeat-leads" headers={repeatHeaders} rows={repeatRows} />
              </div>
              <DataTable headers={repeatHeaders} rows={repeatRows} />
            </div>
          )}
        </AnalyticsCard>
      </div>
    </div>
  );
}
