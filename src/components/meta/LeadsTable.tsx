"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { useToast } from "@/components/Toast";
import MoveToCrmDialog, { type Rep } from "@/components/meta/MoveToCrmDialog";
import type { MetaLeadRow } from "@/lib/meta-ads/queries";

type Tally = { key: string; label: string; count: number };

// Group leads by a picked field (city/sport), case-insensitively; null/blank
// values fall into a "—" bucket. Sorted by count desc, then label.
function tally(leads: MetaLeadRow[], pick: (l: MetaLeadRow) => string | null): Tally[] {
  const m = new Map<string, Tally>();
  for (const l of leads) {
    const raw = (pick(l) ?? "").trim();
    const key = raw.toLowerCase() || "—";
    const label = raw || "—";
    const cur = m.get(key);
    if (cur) cur.count += 1;
    else m.set(key, { key, label, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function BreakdownList({
  title,
  items,
  activeKey,
  onPick,
}: {
  title: string;
  items: Tally[];
  activeKey: string;
  onPick: (label: string) => void;
}) {
  return (
    <div className="card p-3">
      <div className="heading text-xs tracking-wide text-slate-500 mb-2">
        {title} <span className="text-slate-400 normal-case font-serif font-normal">· {items.length}</span>
      </div>
      <div className="max-h-44 overflow-y-auto pr-1 space-y-1">
        {items.map((t) => {
          // Contains-match so the highlight mirrors the type-to-filter model
          // (typing "mum" highlights "Mumbai"), not exact equality.
          const active = !!activeKey && t.key.includes(activeKey);
          // The blank-value ("—") bucket is informational only: an empty filter
          // already includes those rows, so there's nothing to narrow to.
          if (t.label === "—") {
            return (
              <div key={t.key} className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1 text-slate-400">
                <span className="truncate">{t.label}</span>
                <span className="font-mono shrink-0 text-slate-400">{t.count}</span>
              </div>
            );
          }
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t.label)}
              className={`w-full flex items-center justify-between gap-2 text-left text-xs px-2 py-1 rounded transition ${
                active ? "bg-court-600 text-white font-semibold" : "hover:bg-slate-100 text-slate-700"
              }`}
            >
              <span className="truncate">{t.label}</span>
              <span className={`font-mono shrink-0 ${active ? "text-court-100" : "text-slate-400"}`}>{t.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LeadsTable({
  leads,
  reps,
  showCampaignColumn,
  exportFilename,
}: {
  leads: MetaLeadRow[];
  reps: Rep[];
  showCampaignColumn: boolean;
  exportFilename: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const uid = useId();
  const [movingLead, setMovingLead] = useState<MetaLeadRow | null>(null);
  const [marketingBusyId, setMarketingBusyId] = useState<string | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [sportQuery, setSportQuery] = useState("");

  // One-click "Move to WhatsApp marketing" — upserts the lead's phone into the
  // marketing Contact list. No owner picker; the route is idempotent.
  async function moveToMarketing(l: MetaLeadRow) {
    setMarketingBusyId(l.id);
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${l.id}/move-to-marketing`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ? String(err.error) : "Could not add this lead to WhatsApp marketing");
        return;
      }
      toast.success("Lead added to WhatsApp marketing");
    } catch {
      toast.error("Could not add this lead to WhatsApp marketing");
    } finally {
      setMarketingBusyId(null);
    }
  }

  const cq = cityQuery.trim().toLowerCase();
  const sq = sportQuery.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        const cityOk = !cq || (l.city ?? "").toLowerCase().includes(cq);
        const sportOk = !sq || (l.sport ?? "").toLowerCase().includes(sq);
        return cityOk && sportOk;
      }),
    [leads, cq, sq]
  );

  // Datalist options come from ALL leads (so you can always pick any value);
  // the breakdown counts reflect the CURRENT filtered view.
  const allCities = useMemo(() => tally(leads, (l) => l.city), [leads]);
  const allSports = useMemo(() => tally(leads, (l) => l.sport), [leads]);
  const cityBreakdown = useMemo(() => tally(filtered, (l) => l.city), [filtered]);
  const sportBreakdown = useMemo(() => tally(filtered, (l) => l.sport), [filtered]);

  const hasFilter = !!(cityQuery || sportQuery);

  const headers = [
    "Name", "Phone", "Email", "City", "Sport", "Form",
    ...(showCampaignColumn ? ["Campaign"] : []),
    "Captured", "CRM",
  ];
  const exportRows: (string | number)[][] = filtered.map((l) => [
    l.fullName ?? "—",
    l.phone ?? "—",
    l.email ?? "—",
    l.city ?? "—",
    l.sport ?? "—",
    l.formName ?? "—",
    ...(showCampaignColumn ? [l.campaignName ?? "—"] : []),
    new Date(l.capturedAt).toLocaleDateString("en-IN"),
    l.inCrm ? "In CRM" : "—",
  ]);

  if (leads.length === 0) {
    return <p className="text-sm text-slate-400">No leads captured in this range.</p>;
  }

  const inputCls = "input w-44 text-sm";

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">City</label>
          <input
            list={`${uid}-cities`}
            value={cityQuery}
            onChange={(e) => setCityQuery(e.target.value)}
            placeholder="Type or choose…"
            className={inputCls}
          />
          <datalist id={`${uid}-cities`}>
            {allCities.filter((c) => c.label !== "—").map((c) => (
              <option key={c.key} value={c.label} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Sport</label>
          <input
            list={`${uid}-sports`}
            value={sportQuery}
            onChange={(e) => setSportQuery(e.target.value)}
            placeholder="Type or choose…"
            className={inputCls}
          />
          <datalist id={`${uid}-sports`}>
            {allSports.filter((s) => s.label !== "—").map((s) => (
              <option key={s.key} value={s.label} />
            ))}
          </datalist>
        </div>
        <div className="text-xs text-slate-500 pb-1.5">
          Showing <b className="text-slate-800 font-mono">{filtered.length}</b> of <span className="font-mono">{leads.length}</span>
          {hasFilter && <span className="text-slate-400"> (filtered)</span>}
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setCityQuery("");
              setSportQuery("");
            }}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5"
          >
            Clear
          </button>
        )}
        <div className="ml-auto">
          <ExportButtons filename={exportFilename} headers={headers} rows={exportRows} />
        </div>
      </div>

      {/* Breakdown — click a value to filter by it */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <BreakdownList
          title="Leads by city"
          items={cityBreakdown}
          activeKey={cq}
          onPick={(label) => setCityQuery((v) => (v.trim().toLowerCase() === label.toLowerCase() ? "" : label))}
        />
        <BreakdownList
          title="Leads by sport"
          items={sportBreakdown}
          activeKey={sq}
          onPick={(label) => setSportQuery((v) => (v.trim().toLowerCase() === label.toLowerCase() ? "" : label))}
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No leads match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className={`whitespace-nowrap ${h === "CRM" ? "!text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap font-medium">
                    <Link href={`/ad-campaigns/leads/${l.id}`} className="text-court-700 hover:underline">
                      {l.fullName ?? "—"}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-slate-700 font-mono">{l.phone ?? "—"}</td>
                  <td className="whitespace-nowrap text-slate-700">{l.email ?? "—"}</td>
                  <td className="whitespace-nowrap text-slate-700">{l.city ?? "—"}</td>
                  <td className="whitespace-nowrap text-slate-700">{l.sport ?? "—"}</td>
                  <td className="whitespace-nowrap text-slate-700">{l.formName ?? "—"}</td>
                  {showCampaignColumn && (
                    <td className="whitespace-nowrap text-slate-700">{l.campaignName ?? "—"}</td>
                  )}
                  <td className="whitespace-nowrap text-slate-500 font-mono">
                    {new Date(l.capturedAt).toLocaleDateString("en-IN")}
                  </td>
                  <td className="whitespace-nowrap !text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => moveToMarketing(l)}
                        disabled={marketingBusyId === l.id}
                        title="Add this lead's phone to the WhatsApp marketing contact list"
                        className="btn btn-secondary !px-2.5 !py-1 !text-xs"
                      >
                        {marketingBusyId === l.id ? "…" : "→ WhatsApp"}
                      </button>
                      {l.inCrm ? (
                        <span className="badge bg-green-100 text-green-700">In CRM ✓</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setMovingLead(l)}
                          className="btn btn-primary !px-2.5 !py-1 !text-xs"
                        >
                          Move to CRM
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
