"use client";

import { Fragment, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import MoveToCrmDialog, { type Rep } from "@/components/meta/MoveToCrmDialog";
import type { MetaLeadRow } from "@/lib/meta-ads/queries";

// field_data is a raw JSON string produced by the lead-ingest path; parse
// defensively and support both Meta's [{ name, values: [...] }] array form and a
// plain { key: value } object.
function parseFieldData(raw: string): { name: string; value: string }[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((f: { name?: unknown; value?: unknown; values?: unknown }) => ({
          name: String(f?.name ?? ""),
          value: Array.isArray(f?.values) ? f.values.join(", ") : String(f?.value ?? (f?.values as unknown) ?? ""),
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
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {title} <span className="text-slate-400 normal-case">· {items.length}</span>
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
                <span className="tabular-nums shrink-0 text-slate-400">{t.count}</span>
              </div>
            );
          }
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t.label)}
              className={`w-full flex items-center justify-between gap-2 text-left text-xs px-2 py-1 rounded-md transition ${
                active ? "bg-wa-green/15 text-wa-dark font-semibold" : "hover:bg-slate-100 text-slate-700"
              }`}
            >
              <span className="truncate">{t.label}</span>
              <span className={`tabular-nums shrink-0 ${active ? "text-wa-dark" : "text-slate-400"}`}>{t.count}</span>
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
  const uid = useId();
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [movingLead, setMovingLead] = useState<MetaLeadRow | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [sportQuery, setSportQuery] = useState("");

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
  const colSpan = headers.length;

  if (leads.length === 0) {
    return <p className="text-sm text-slate-400">No leads captured in this range.</p>;
  }

  const inputCls =
    "w-44 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green/30";

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
          Showing <b className="text-slate-800">{filtered.length}</b> of {leads.length}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200">
                {headers.map((h, i) => (
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
              {filtered.map((l) => {
                const isOpen = openLead === l.id;
                const fields = isOpen ? parseFieldData(l.fieldData) : [];
                return (
                  <Fragment key={l.id}>
                    <tr
                      onClick={() => setOpenLead(isOpen ? null : l.id)}
                      className="border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-2 py-2 whitespace-nowrap font-medium text-slate-900">
                        <span className={`inline-block mr-1.5 text-slate-400 text-xs transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                        {l.fullName ?? "—"}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.phone ?? "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.email ?? "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.city ?? "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.sport ?? "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.formName ?? "—"}</td>
                      {showCampaignColumn && (
                        <td className="px-2 py-2 whitespace-nowrap text-slate-700">{l.campaignName ?? "—"}</td>
                      )}
                      <td className="px-2 py-2 whitespace-nowrap text-slate-500">
                        {new Date(l.capturedAt).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
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
                        <td colSpan={colSpan} className="px-4 py-3">
                          {fields.length === 0 ? (
                            <p className="text-xs text-slate-400">No additional form fields recorded.</p>
                          ) : (
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                              {fields.map((f, i) => (
                                <div key={i} className="flex gap-2 text-xs">
                                  <dt className="text-slate-500 font-medium capitalize whitespace-nowrap">{f.name.replace(/_/g, " ")}</dt>
                                  <dd className="text-slate-800 break-words">{f.value || "—"}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {!l.inCrm && (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => setMovingLead(l)}
                                title="Create a CRM contact from this lead and assign an owner"
                                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-wa-green text-white hover:bg-wa-green/90"
                              >
                                Move to CRM
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
