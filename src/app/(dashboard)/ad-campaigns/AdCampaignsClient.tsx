"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import { AnalyticsCard } from "@/components/analytics/AnalyticsCard";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { fmtInr, fmtPct } from "@/components/analytics/charts";
import { StatusBadge } from "@/components/meta/StatusBadge";
import { useToast } from "@/components/Toast";
import MetaAiSummary from "@/components/MetaAiSummary";
import type { AdCampaignOverview, CampaignListRow, MetaLeadRow } from "@/lib/meta-ads/queries";

type Rep = { id: string; name: string };

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
  const [openLead, setOpenLead] = useState<string | null>(null);
  // The lead currently being moved into the CRM — non-null opens the rep-picker
  // dialog. On success we router.refresh() so the row re-renders as "In CRM ✓".
  const [movingLead, setMovingLead] = useState<MetaLeadRow | null>(null);

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

  const leadHeaders = ["Name", "Phone", "Email", "City", "Sport", "Form", "Campaign", "Captured", "CRM"];
  const leadRows: (string | number)[][] = leads.map((l) => [
    l.fullName ?? "—",
    l.phone ?? "—",
    l.email ?? "—",
    l.city ?? "—",
    l.sport ?? "—",
    l.formName ?? "—",
    l.campaignName ?? "—",
    new Date(l.capturedAt).toLocaleDateString("en-IN"),
    l.inCrm ? "In CRM" : "—",
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
                          {c.objective && (
                            <div className="text-xs text-slate-400 font-normal">{c.objective}</div>
                          )}
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
                      {["Name", "Phone", "Email", "City", "Sport", "Form", "Campaign", "Captured", "CRM"].map((h, i) => (
                        <th
                          key={i}
                          className={`px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap ${
                            h === "CRM" ? "text-right" : ""
                          }`}
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
                            <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.campaignName ?? "—"}</td>
                            <td className="px-2 py-2 whitespace-nowrap text-slate-500">
                              {new Date(l.capturedAt).toLocaleDateString("en-IN")}
                            </td>
                            <td
                              className="px-2 py-2 whitespace-nowrap text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {l.inCrm ? (
                                <span className="text-xs font-semibold text-emerald-700">In CRM ✓</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setMovingLead(l)}
                                  className="text-xs font-medium px-2.5 py-1 rounded-lg bg-wa-green/10 text-wa-dark hover:bg-wa-green/20"
                                >
                                  Move to CRM
                                </button>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-slate-100 bg-slate-50/60">
                              <td colSpan={9} className="px-4 py-3">
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
                                  {l.inCrm ? (
                                    <span className="text-xs font-semibold text-emerald-700">In CRM ✓</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setMovingLead(l)}
                                      title="Create a CRM contact from this lead and assign an owner"
                                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-wa-green text-white hover:bg-wa-green/90"
                                    >
                                      Move to CRM
                                    </button>
                                  )}
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

      {movingLead && (
        <MoveToCrmDialog
          lead={movingLead}
          reps={reps}
          onClose={() => setMovingLead(null)}
          onDone={() => {
            setMovingLead(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// Small modal: pick an owner (rep) and move a captured lead into the CRM. POSTs
// to the move route (built separately) which creates the Account + AccountContact
// and back-links MetaLead.accountContactId; on success the caller refreshes so
// the row re-renders as "In CRM ✓".
function MoveToCrmDialog({
  lead,
  reps,
  onClose,
  onDone,
}: {
  lead: MetaLeadRow;
  reps: Rep[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [ownerUserId, setOwnerUserId] = useState<string>(reps[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!ownerUserId) {
      toast.error("Pick an owner first");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${lead.id}/move-to-crm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUserId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ? String(err.error) : "Could not move this lead to the CRM");
        return;
      }
      toast.success("Lead moved to the CRM");
      onDone();
    } catch {
      toast.error("Could not move this lead to the CRM");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-slate-900">Move to CRM</h2>
        <p className="text-xs text-slate-500 mt-1">
          Creates a CRM contact from {lead.fullName ? <span className="font-medium text-slate-700">{lead.fullName}</span> : "this lead"}
          {lead.phone ? ` (${lead.phone})` : ""} and assigns it to the owner you pick.
        </p>

        <label className="block text-xs font-medium text-slate-600 mt-4 mb-1">Owner</label>
        {reps.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            No assignable reps found — add an active, approved user first.
          </p>
        ) : (
          <select
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green/30"
          >
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 border border-slate-300 bg-white rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || reps.length === 0 || !ownerUserId}
            className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Moving…" : "Move to CRM"}
          </button>
        </div>
      </div>
    </div>
  );
}
