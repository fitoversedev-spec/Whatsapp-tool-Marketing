"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { fmtInr, fmtPct } from "@/components/analytics/charts";
import { StatusBadge } from "@/components/meta/StatusBadge";
import MetaAiSummary from "@/components/MetaAiSummary";
import LeadsTable from "@/components/meta/LeadsTable";
import type { Rep } from "@/components/meta/MoveToCrmDialog";
import type { AdCampaignOverview, CampaignListRow, MetaLeadRow } from "@/lib/meta-ads/queries";

// Cost per lead is plain rupees — there is no fmtCpl, so it's formatted with
// fmtInr like every other money figure. CTR comes through as a fraction (0..1)
// so it feeds fmtPct directly.
function fmtCpl(n: number | null): string {
  return n == null ? "—" : fmtInr(Math.round(n));
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-IN");
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

export default function AdCampaignsClient({
  overview,
  leads,
  campaigns,
  reps,
  range,
}: {
  overview: AdCampaignOverview;
  leads: MetaLeadRow[];
  campaigns: CampaignListRow[];
  reps: Rep[];
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
      router.push(qs ? `/ad-campaigns?${qs}` : "/ad-campaigns");
    });
  }

  const k = overview.kpis;

  // Export mirrors the bespoke Campaigns table below (lifetime roster). "Insight
  // leads" = AdInsight.leads KPI; "Captured leads" = count of ingested MetaLeads
  // — deliberately two separate numbers.
  const campaignHeaders = ["Campaign", "Status", "Spend", "Insight leads", "Captured leads", "Cost / lead"];
  const campaignRows: (string | number)[][] = campaigns.map((c) => [
    c.name,
    c.status ?? "—",
    fmtInr(c.spend),
    c.insightLeads,
    c.capturedLeads,
    fmtCpl(c.cpl),
  ]);

  const hasAnyData = campaigns.length > 0 || overview.campaigns.length > 0 || leads.length > 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        large
        title="Ad Campaigns"
        description="Meta ad performance and lead-gen leads — spend, cost per lead, and every Instant-Form submission, over the selected range."
        action={<DateRangePicker value={range} onApply={applyRange} />}
      />

      <div className={`mt-4 space-y-4 ${pending ? "opacity-60 transition-opacity" : ""}`}>
        {pending && <div className="text-xs text-slate-400">Updating…</div>}

        {!hasAnyData && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
            No ad data in this range yet. Connect Meta Ads on the{" "}
            <Link href="/connection" className="font-medium underline">
              Connection
            </Link>{" "}
            page — the daily sync then pulls campaign performance, and lead-gen leads flow in as they&apos;re submitted.
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiTile label="Total spend" value={fmtInr(k.totalSpend)} sub={`${k.campaignCount} campaign${k.campaignCount === 1 ? "" : "s"}`} />
          <KpiTile label="Leads" value={fmtInt(k.totalLeads)} sub="From ad insights" />
          <KpiTile label="Avg cost / lead" value={fmtCpl(k.avgCpl)} sub="Spend ÷ leads" />
          <KpiTile label="Avg CTR" value={fmtPct(k.avgCtr)} sub={`${fmtInt(k.totalClicks)} clicks · ${fmtInt(k.totalImpressions)} impressions`} />
        </div>

        {/* Ask AI — freeform questions answered only from the real ad data above */}
        <MetaAiSummary />

        {/* All campaigns — a navigable roster (lifetime totals, not windowed by
            the date range). Click a campaign name to drill into its detail. */}
        <AnalyticsCard
          title="Campaigns"
          description="Every campaign with its lifetime spend and lead volume. Insight leads are Meta's own count; captured leads are the Instant-Form submissions we ingested. Click a name to drill in."
        >
          {campaigns.length === 0 ? (
            <p className="text-sm text-slate-400">No campaigns synced yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <ExportButtons filename="ad-campaigns" headers={campaignHeaders} rows={campaignRows} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-slate-200">
                      {["Campaign", "Status", "Spend", "Insight leads", "Captured leads", "Cost / lead"].map((h, i) => (
                        <th
                          key={i}
                          className={`px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap ${
                            i >= 2 ? "text-right" : ""
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.metaId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-2 py-2 font-medium">
                          <Link href={`/ad-campaigns/${c.metaId}`} className="text-wa-dark hover:underline">
                            {c.name}
                          </Link>
                          {c.objective && <div className="text-xs text-slate-400 font-normal">{c.objective}</div>}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-slate-700">{fmtInr(c.spend)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-slate-700">{fmtInt(c.insightLeads)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-slate-700">{fmtInt(c.capturedLeads)}</td>
                        <td className="px-2 py-2 whitespace-nowrap text-right text-slate-700">{fmtCpl(c.cpl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </AnalyticsCard>

        {/* Lead-gen leads — filterable by city / sport, with a live breakdown */}
        <AnalyticsCard
          title="Lead-gen leads"
          description="Every Instant-Form submission captured from your ads. Filter by city or sport, click a breakdown value to drill in, or click a row for the full form answers."
        >
          <LeadsTable leads={leads} reps={reps} showCampaignColumn exportFilename="ad-leads" />
        </AnalyticsCard>
      </div>
    </div>
  );
}
