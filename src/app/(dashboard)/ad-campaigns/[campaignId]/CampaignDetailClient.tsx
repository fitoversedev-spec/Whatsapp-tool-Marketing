"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { StackedBarChart, fmtInr, fmtPct } from "@/components/analytics/charts";
import { StatusBadge } from "@/components/meta/StatusBadge";
import LeadsTable from "@/components/meta/LeadsTable";
import type { Rep } from "@/components/meta/MoveToCrmDialog";
import type { CampaignDetail, MetaLeadRow, AdLeadBreakdownRow } from "@/lib/meta-ads/queries";

// Cost per lead is plain rupees — there is no fmtCpl, so it's formatted with
// fmtInr like every other money figure. CTR arrives as a fraction (0..1), so it
// feeds fmtPct directly.
function fmtCpl(n: number | null): string {
  return n == null ? "—" : fmtInr(Math.round(n));
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-IN");
}

// A YYYY-MM-DD point label → a short "6 Aug" tick for the trend x-axis.
function shortDate(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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

// Ranked "which ad drove the most leads" list, most → least, each with the city
// distribution of its leads and a mini bar scaled to the top ad.
function AdBreakdown({ rows }: { rows: AdLeadBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">No leads captured for this campaign in this range.</p>;
  }
  const max = rows[0].leadCount || 1;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.adId ?? `none-${i}`} className="border border-slate-200 rounded-lg p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-slate-900 break-words">
                <span className="text-slate-400 tabular-nums mr-1.5">{i + 1}.</span>
                {r.adName}
              </div>
            </div>
            <div className="shrink-0 text-right leading-tight">
              <div className="text-lg font-semibold text-slate-900 tabular-nums">{fmtInt(r.leadCount)}</div>
              <div className="text-[11px] text-slate-400">leads</div>
            </div>
          </div>
          <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-wa-green rounded-full"
              style={{ width: `${Math.max(3, Math.round((r.leadCount / max) * 100))}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.cities.map((c) => (
              <span key={c.city} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {c.city} <span className="text-slate-400 tabular-nums">{c.count}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const SPEND_COLOR = "#159341"; // brand green — daily spend bars
const LEADS_COLOR = "#0ea5e9"; // sky — daily captured-insight lead bars

export default function CampaignDetailClient({
  detail,
  leads,
  reps,
  adBreakdown,
  range,
}: {
  detail: CampaignDetail;
  leads: MetaLeadRow[];
  reps: Rep[];
  adBreakdown: AdLeadBreakdownRow[];
  range: DateRange;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Applying a range pushes ?from/?to on THIS campaign's URL; the server page
  // re-fetches on the new query string. useTransition keeps the old data
  // visible with a subtle "Updating…" hint instead of blanking the screen.
  function applyRange(next: DateRange) {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    const qs = params.toString();
    const base = `/ad-campaigns/${detail.metaId}`;
    startTransition(() => {
      router.push(qs ? `${base}?${qs}` : base);
    });
  }

  // Per-day trend rows — spend and leads share the x-axis (date) but live on
  // separate charts because their scales differ by orders of magnitude.
  const trend = detail.series.map((p) => ({
    date: shortDate(p.date),
    spend: p.spend,
    leads: p.leads,
  }));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        large
        backHref="/ad-campaigns"
        title={detail.name}
        description="Spend, cost per lead, and every Instant-Form submission for this campaign over the selected range."
        action={<DateRangePicker value={range} onApply={applyRange} />}
      />

      <div className={`mt-4 space-y-4 ${pending ? "opacity-60 transition-opacity" : ""}`}>
        <div className="flex items-center gap-2">
          <StatusBadge status={detail.status} />
          {detail.objective && <span className="text-sm text-slate-500">{detail.objective}</span>}
          {pending && <span className="text-xs text-slate-400">Updating…</span>}
        </div>

        {/* Headline KPIs. The two lead numbers are deliberately kept apart:
            insightLeads is Meta's own Insights KPI, capturedLeads is the count
            of Instant-Form submissions we actually ingested for this campaign. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile label="Spend" value={fmtInr(detail.spend)} sub={`${fmtInt(detail.reach)} reach`} />
          <KpiTile label="Impressions" value={fmtInt(detail.impressions)} />
          <KpiTile label="Clicks" value={fmtInt(detail.clicks)} sub={`${fmtPct(detail.ctr)} CTR`} />
          <KpiTile label="CTR" value={fmtPct(detail.ctr)} sub="Clicks ÷ impressions" />
          <KpiTile label="Insight leads" value={fmtInt(detail.insightLeads)} sub="Meta insights KPI" />
          <KpiTile label="Captured leads" value={fmtInt(detail.capturedLeads)} sub="Instant-Form submissions" />
          <KpiTile label="Cost / lead" value={fmtCpl(detail.cpl)} sub="Spend ÷ insight leads" />
          <KpiTile label="Reach" value={fmtInt(detail.reach)} sub="Summed per day (approx.)" />
        </div>

        {/* Spend / leads trend */}
        <AnalyticsCard title="Daily trend" description="Spend and lead volume per day over the selected range.">
          {trend.length === 0 ? (
            <p className="text-sm text-slate-400">No daily insights in this range.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Spend / day</div>
                <StackedBarChart
                  data={trend}
                  dataKey="date"
                  stackKeys={["spend"]}
                  height={220}
                  colorFor={() => SPEND_COLOR}
                  tooltipFormatter={(d) => fmtInr(d.spend)}
                />
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Leads / day</div>
                <StackedBarChart
                  data={trend}
                  dataKey="date"
                  stackKeys={["leads"]}
                  height={220}
                  colorFor={() => LEADS_COLOR}
                  tooltipFormatter={(d) => `${fmtInt(d.leads)} leads`}
                />
              </div>
            </div>
          )}
        </AnalyticsCard>

        {/* Which ad drove the most leads, and from which cities */}
        <AnalyticsCard
          title="Leads by ad"
          description="Which ad drove the most leads for this campaign — most to least — and the cities those leads came from."
        >
          <AdBreakdown rows={adBreakdown} />
        </AnalyticsCard>

        {/* This campaign's captured leads — filterable by city / sport */}
        <AnalyticsCard
          title="Captured leads"
          description="Every Instant-Form submission captured from this campaign. Filter by city or sport, click a breakdown value to drill in, or open a lead for the full form answers."
        >
          <LeadsTable
            leads={leads}
            reps={reps}
            showCampaignColumn={false}
            exportFilename={`campaign-${detail.metaId}-leads`}
          />
        </AnalyticsCard>
      </div>
    </div>
  );
}
