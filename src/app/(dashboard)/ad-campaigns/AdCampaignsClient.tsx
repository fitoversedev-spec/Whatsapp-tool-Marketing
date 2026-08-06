"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { DataTable } from "@/components/analytics/DataTable";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { fmtInr, fmtPct } from "@/components/analytics/charts";
import MetaAiSummary from "@/components/MetaAiSummary";
import type { AdCampaignOverview, MetaLeadRow } from "@/lib/meta-ads/queries";

// Cost per lead is plain rupees — there is no fmtCpl, so it's formatted with
// fmtInr like every other money figure. CTR comes through as a fraction (0..1)
// so it feeds fmtPct directly.
function fmtCpl(n: number | null): string {
  return n == null ? "—" : fmtInr(Math.round(n));
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-IN");
}

// field_data is a raw JSON string produced by the lead-ingest path; its exact
// shape isn't guaranteed here, so parse defensively and support both Meta's
// [{ name, values: [...] }] array form and a plain { key: value } object.
function parseFieldData(raw: string): { name: string; value: string }[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((f: { name?: unknown; value?: unknown; values?: unknown }) => ({
          name: String(f?.name ?? ""),
          value: Array.isArray(f?.values)
            ? f.values.join(", ")
            : String(f?.value ?? (f?.values as unknown) ?? ""),
        }))
        .filter((f) => f.name);
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>).map(([name, value]) => ({
        name,
        value: Array.isArray(value) ? value.join(", ") : String(value),
      }));
    }
  } catch {
    /* not JSON — nothing to expand */
  }
  return [];
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
  range,
}: {
  overview: AdCampaignOverview;
  leads: MetaLeadRow[];
  range: DateRange;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openLead, setOpenLead] = useState<string | null>(null);

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

  const campaignHeaders = ["Campaign", "Status", "Spend", "Impressions", "Clicks", "CTR", "Leads", "Cost / lead"];
  const campaignRows: (string | number)[][] = overview.campaigns.map((c) => [
    c.name,
    c.status ?? "—",
    fmtInr(c.spend),
    fmtInt(c.impressions),
    fmtInt(c.clicks),
    fmtPct(c.ctr),
    c.leads,
    fmtCpl(c.cpl),
  ]);

  const leadHeaders = ["Name", "Phone", "Email", "Form", "Campaign", "Captured", "CRM"];
  const leadRows: (string | number)[][] = leads.map((l) => [
    l.fullName ?? "—",
    l.phone ?? "—",
    l.email ?? "—",
    l.formName ?? "—",
    l.campaignName ?? "—",
    new Date(l.capturedAt).toLocaleDateString("en-IN"),
    l.inCrm ? "In CRM" : "—",
  ]);

  const hasAnyData = overview.campaigns.length > 0 || leads.length > 0;

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

        {/* Per-campaign performance */}
        <AnalyticsCard
          title="Campaign performance"
          description="Spend, reach, clicks, and lead volume per campaign over the selected range. Sorted by spend."
        >
          {overview.campaigns.length === 0 ? (
            <p className="text-sm text-slate-400">No campaign performance in this range.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <ExportButtons filename="ad-campaigns" headers={campaignHeaders} rows={campaignRows} />
              </div>
              <DataTable headers={campaignHeaders} rows={campaignRows} />
            </div>
          )}
        </AnalyticsCard>

        {/* Lead-gen leads */}
        <AnalyticsCard
          title="Lead-gen leads"
          description="Every Instant-Form submission captured from your ads. Click a row to see the full form answers."
        >
          {leads.length === 0 ? (
            <p className="text-sm text-slate-400">No leads captured in this range.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <ExportButtons filename="ad-leads" headers={leadHeaders} rows={leadRows} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-slate-200">
                      {["Name", "Phone", "Email", "Form", "Campaign", "Captured", ""].map((h, i) => (
                        <th
                          key={i}
                          className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => {
                      const isOpen = openLead === l.id;
                      const fields = isOpen ? parseFieldData(l.fieldData) : [];
                      return (
                        <Fragment key={l.id}>
                          <tr
                            onClick={() => setOpenLead(isOpen ? null : l.id)}
                            className="border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50"
                          >
                            <td className="px-2 py-2 whitespace-nowrap font-medium text-slate-900">
                              <span className={`inline-block mr-1.5 text-slate-400 text-xs transition-transform ${isOpen ? "rotate-90" : ""}`}>
                                ▶
                              </span>
                              {l.fullName ?? "—"}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.phone ?? "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.email ?? "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.formName ?? "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.campaignName ?? "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-500">
                              {new Date(l.capturedAt).toLocaleDateString("en-IN")}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-right">
                              {l.inCrm ? (
                                <span className="text-xs font-medium text-emerald-700">In CRM</span>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-slate-100 bg-slate-50/60">
                              <td colSpan={7} className="px-4 py-3">
                                {fields.length === 0 ? (
                                  <p className="text-xs text-slate-400">No additional form fields recorded.</p>
                                ) : (
                                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                                    {fields.map((f, i) => (
                                      <div key={i} className="flex gap-2 text-xs">
                                        <dt className="text-slate-500 font-medium capitalize whitespace-nowrap">
                                          {f.name.replace(/_/g, " ")}
                                        </dt>
                                        <dd className="text-slate-800 break-words">{f.value || "—"}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                                <div className="mt-3">
                                  <button
                                    type="button"
                                    disabled
                                    title="Coming soon — link this lead into the CRM pipeline"
                                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed"
                                  >
                                    {l.inCrm ? "Already in CRM" : "Move to CRM (coming soon)"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </AnalyticsCard>
      </div>
    </div>
  );
}
