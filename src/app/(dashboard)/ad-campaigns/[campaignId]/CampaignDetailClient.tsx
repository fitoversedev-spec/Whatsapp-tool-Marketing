"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { StackedBarChart, fmtInr, fmtPct } from "@/components/analytics/charts";
import { StatusBadge } from "@/components/meta/StatusBadge";
import type { CampaignDetail, MetaLeadRow } from "@/lib/meta-ads/queries";

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

// field_data is a raw JSON string produced by the lead-ingest path; its exact
// shape isn't guaranteed here, so parse defensively and support both Meta's
// [{ name, values: [...] }] array form and a plain { key: value } object.
// Mirrors the parseFieldData in the Ad Campaigns list so the expandable row
// renders identically here.
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

const SPEND_COLOR = "#159341"; // brand green — daily spend bars
const LEADS_COLOR = "#0ea5e9"; // sky — daily captured-insight lead bars

export default function CampaignDetailClient({
  detail,
  leads,
  range,
}: {
  detail: CampaignDetail;
  leads: MetaLeadRow[];
  range: DateRange;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openLead, setOpenLead] = useState<string | null>(null);

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

  const leadHeaders = ["Name", "Phone", "Email", "City", "Sport", "Form", "Captured", "CRM"];
  const leadRows: (string | number)[][] = leads.map((l) => [
    l.fullName ?? "—",
    l.phone ?? "—",
    l.email ?? "—",
    l.city ?? "—",
    l.sport ?? "—",
    l.formName ?? "—",
    new Date(l.capturedAt).toLocaleDateString("en-IN"),
    l.inCrm ? "In CRM" : "—",
  ]);

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
        <AnalyticsCard
          title="Daily trend"
          description="Spend and lead volume per day over the selected range."
        >
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

        {/* This campaign's captured leads */}
        <AnalyticsCard
          title="Captured leads"
          description="Every Instant-Form submission captured from this campaign. Click a row to see the full form answers."
        >
          {leads.length === 0 ? (
            <p className="text-sm text-slate-400">No leads captured for this campaign in this range.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <ExportButtons filename={`campaign-${detail.metaId}-leads`} headers={leadHeaders} rows={leadRows} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-slate-200">
                      {["Name", "Phone", "Email", "City", "Sport", "Form", "Captured", ""].map((h, i) => (
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
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.city ?? "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.sport ?? "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.formName ?? "—"}</td>
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
                              <td colSpan={8} className="px-4 py-3">
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
