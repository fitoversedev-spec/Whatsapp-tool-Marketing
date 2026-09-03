"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { useToast } from "@/components/Toast";
import MoveToCrmDialog, { type Rep } from "@/components/meta/MoveToCrmDialog";
import LeadManagementPanel from "@/components/meta/LeadManagementPanel";
import type { MetaLeadRow, MetaLeadDetail, MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import { LEAD_STAGES, LEAD_STAGE_LABELS, LEAD_STAGE_CHIP, stageLabel, labelChip, labelDot } from "@/lib/meta-ads/lead-fields";

type Tally = { key: string; label: string; count: number };

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
          const active = !!activeKey && t.key.includes(activeKey);
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

const FILTER_STORAGE_PREFIX = "leads-filter-";

type DropdownOption = { label: string; count: number };

function DropdownFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: DropdownOption[] }) {
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

  const filtered = search ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())) : options;

  return (
    <div ref={ref} className="relative">
      <label className="block text-[11px] font-medium text-slate-600 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="flex items-center justify-between gap-1 w-44 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-left hover:border-slate-400 transition-colors"
      >
        <span className={value ? "text-slate-900 truncate" : "text-slate-400 truncate"}>{value || "Choose…"}</span>
        <svg className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg">
          {options.length > 5 && (
            <div className="p-1.5 border-b border-slate-100">
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400" />
            </div>
          )}
          <div className="max-h-52 overflow-y-auto py-1">
            {value && (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="w-full px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50">Clear selection</button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
            ) : (
              filtered.map((o) => (
                <button key={o.label} type="button" onClick={() => { onChange(o.label); setOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors ${o.label === value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700"}`}>
                  <span className="truncate text-left">{o.label}</span>
                  <span className="shrink-0 text-xs font-mono text-slate-400">{o.count}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadsTable({
  leads: serverLeads,
  reps,
  showCampaignColumn,
  exportFilename,
  labelCatalog = [],
  currentUserId = "",
  isAdmin = false,
}: {
  leads: MetaLeadRow[];
  reps: Rep[];
  showCampaignColumn: boolean;
  exportFilename: string;
  labelCatalog?: MetaLeadLabelChip[];
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const uid = useId();
  const [movingLead, setMovingLead] = useState<MetaLeadRow | null>(null);
  const [marketingBusyId, setMarketingBusyId] = useState<string | null>(null);

  // Local leads state: starts from server data, updated when sidebar changes stage/labels.
  // localChanges tracks per-lead field overrides so router.refresh() can't overwrite them.
  const [localChanges, setLocalChanges] = useState<Record<string, Partial<MetaLeadRow>>>({});
  const localLeads = useMemo(
    () => serverLeads.map((l) => (localChanges[l.id] ? { ...l, ...localChanges[l.id] } : l)),
    [serverLeads, localChanges],
  );

  // Refresh server data when the page becomes visible again (picks up
  // stage/label changes made on the detail page). Uses visibilitychange
  // (hidden→visible) instead of focus to avoid firing on every click.
  const wasHiddenRef = useRef(false);
  useEffect(() => {
    function onVisChange() {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
      } else if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        setLocalChanges({});
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [router]);

  // Sidebar state
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [sidebarDetail, setSidebarDetail] = useState<MetaLeadDetail | null>(null);
  const [sidebarLoading, setSidebarLoading] = useState(false);

  // Filter persistence via sessionStorage
  const storageKey = FILTER_STORAGE_PREFIX + exportFilename;
  function readSavedFilters(): { city: string; sport: string; area: string; stage: string } {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { city: "", sport: "", area: "", stage: "" };
  }

  const saved = readSavedFilters();
  const [cityQuery, setCityQuery] = useState(saved.city);
  const [sportQuery, setSportQuery] = useState(saved.sport);
  const [areaQuery, setAreaQuery] = useState(saved.area);
  const [stageFilter, setStageFilter] = useState(saved.stage);

  // Persist filters to sessionStorage on change
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ city: cityQuery, sport: sportQuery, area: areaQuery, stage: stageFilter }));
    } catch { /* ignore */ }
  }, [cityQuery, sportQuery, areaQuery, stageFilter, storageKey]);

  // Fetch sidebar detail when a lead is selected
  const fetchSidebarDetail = useCallback(async (leadId: string) => {
    setSidebarLoading(true);
    setSidebarDetail(null);
    try {
      const res = await fetch(`/api/ad-campaigns/leads/${leadId}`);
      if (res.ok) {
        const data = await res.json();
        setSidebarDetail(data);
      } else {
        toast.error("Could not load lead details");
        setSelectedLeadId(null);
      }
    } catch {
      toast.error("Could not load lead details");
      setSelectedLeadId(null);
    } finally {
      setSidebarLoading(false);
    }
  }, [toast]);

  function handleRowClick(lead: MetaLeadRow) {
    if (selectedLeadId === lead.id) {
      setSelectedLeadId(null);
      setSidebarDetail(null);
      return;
    }
    setSelectedLeadId(lead.id);
    void fetchSidebarDetail(lead.id);
  }

  function handleStageUpdated(leadId: string, newStage: string) {
    setLocalChanges((prev) => ({ ...prev, [leadId]: { ...prev[leadId], stage: newStage } }));
  }

  function handleLabelsUpdated(leadId: string, labels: MetaLeadLabelChip[]) {
    setLocalChanges((prev) => ({ ...prev, [leadId]: { ...prev[leadId], labels } }));
  }

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
  const aq = areaQuery.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      localLeads.filter((l) => {
        const cityOk = !cq || (l.city ?? "").toLowerCase().includes(cq);
        const sportOk = !sq || (l.sport ?? "").toLowerCase().includes(sq);
        const areaOk = !aq || (l.area ?? "").toLowerCase().includes(aq);
        const stageOk = !stageFilter || l.stage === stageFilter;
        return cityOk && sportOk && areaOk && stageOk;
      }),
    [localLeads, cq, sq, aq, stageFilter],
  );

  const allCities = useMemo(() => tally(localLeads, (l) => l.city), [localLeads]);
  const allSports = useMemo(() => tally(localLeads, (l) => l.sport), [localLeads]);
  const allAreas = useMemo(() => tally(localLeads, (l) => l.area), [localLeads]);
  const cityBreakdown = useMemo(() => tally(filtered, (l) => l.city), [filtered]);
  const sportBreakdown = useMemo(() => tally(filtered, (l) => l.sport), [filtered]);
  const areaBreakdown = useMemo(() => tally(filtered, (l) => l.area), [filtered]);

  const hasFilter = !!(cityQuery || sportQuery || areaQuery || stageFilter);

  const headers = [
    "Name", "Phone", "Email", "City", "Sport", "Area", "Form",
    ...(showCampaignColumn ? ["Campaign"] : []),
    "Stage", "Labels", "Captured", "CRM",
  ];
  const exportHeaders = [
    "Name", "Phone", "Email", "City", "Sport", "Area", "Form",
    ...(showCampaignColumn ? ["Campaign"] : []),
    "Stage", "Captured", "CRM",
  ];
  const exportRows: (string | number)[][] = filtered.map((l) => [
    l.fullName ?? "—",
    l.phone ?? "—",
    l.email ?? "—",
    l.city ?? "—",
    l.sport ?? "—",
    l.area ?? "—",
    l.formName ?? "—",
    ...(showCampaignColumn ? [l.campaignName ?? "—"] : []),
    stageLabel(l.stage),
    new Date(l.capturedAt).toLocaleDateString("en-IN"),
    l.inCrm ? "In CRM" : "—",
  ]);

  if (localLeads.length === 0) {
    return <p className="text-sm text-slate-400">No leads captured in this range.</p>;
  }

  const inputCls = "input w-44 text-sm";
  const sidebarOpen = !!selectedLeadId;

  return (
    <>
      <div className="space-y-3">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <DropdownFilter label="City" value={cityQuery} onChange={setCityQuery} options={allCities.filter((c) => c.label !== "—")} />
          <DropdownFilter label="Sport" value={sportQuery} onChange={setSportQuery} options={allSports.filter((s) => s.label !== "—")} />
          <DropdownFilter label="Area" value={areaQuery} onChange={setAreaQuery} options={allAreas.filter((a) => a.label !== "—")} />
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Stage</label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="input w-40 text-sm"
            >
              <option value="">All stages</option>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-slate-500 pb-1.5">
            Showing <b className="text-slate-800 font-mono">{filtered.length}</b> of <span className="font-mono">{localLeads.length}</span>
            {hasFilter && <span className="text-slate-400"> (filtered)</span>}
          </div>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setCityQuery("");
                setSportQuery("");
                setAreaQuery("");
                setStageFilter("");
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5"
            >
              Clear
            </button>
          )}
          <div className="ml-auto">
            <ExportButtons filename={exportFilename} headers={exportHeaders} rows={exportRows} />
          </div>
        </div>

        {/* Breakdown — click a value to filter by it */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
          <BreakdownList
            title="Leads by area"
            items={areaBreakdown}
            activeKey={aq}
            onPick={(label) => setAreaQuery((v) => (v.trim().toLowerCase() === label.toLowerCase() ? "" : label))}
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
                  <tr
                    key={l.id}
                    onClick={() => handleRowClick(l)}
                    className={`cursor-pointer transition-colors ${
                      selectedLeadId === l.id
                        ? "bg-court-50 border-l-2 border-l-court-500"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="whitespace-nowrap font-medium">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-900">{l.fullName ?? "—"}</span>
                        <Link
                          href={`/ad-campaigns/leads/${l.id}`}
                          onClick={(e) => e.stopPropagation()}
                          title="Open full detail page"
                          className="text-slate-400 hover:text-court-600 shrink-0"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </Link>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-slate-700 font-mono">{l.phone ?? "—"}</td>
                    <td className="whitespace-nowrap text-slate-700">{l.email ?? "—"}</td>
                    <td className="whitespace-nowrap text-slate-700">{l.city ?? "—"}</td>
                    <td className="whitespace-nowrap text-slate-700">{l.sport ?? "—"}</td>
                    <td className="whitespace-nowrap text-slate-700">{l.area ?? "—"}</td>
                    <td className="whitespace-nowrap text-slate-700">{l.formName ?? "—"}</td>
                    {showCampaignColumn && (
                      <td className="whitespace-nowrap text-slate-700">{l.campaignName ?? "—"}</td>
                    )}
                    <td className="whitespace-nowrap">
                      <span className={`badge ${LEAD_STAGE_CHIP[l.stage as keyof typeof LEAD_STAGE_CHIP] ?? "bg-slate-100 text-slate-700"}`}>
                        {stageLabel(l.stage)}
                      </span>
                    </td>
                    <td>
                      {l.labels.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {l.labels.map((lb) => (
                            <span
                              key={lb.id}
                              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${labelChip(lb.color)}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${labelDot(lb.color)}`} />
                              {lb.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-slate-500 text-xs font-mono">
                      {new Date(l.capturedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
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
      </div>

      {/* Full-height right sidebar panel (fixed, like Meta Leads Centre) */}
      {sidebarOpen && (
        <>
          {/* Backdrop for mobile — click to close */}
          <div
            className="fixed inset-0 bg-black/20 z-40 lg:hidden"
            onClick={() => { setSelectedLeadId(null); setSidebarDetail(null); }}
          />
          <aside className="fixed top-0 right-0 h-screen w-[400px] max-w-[90vw] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 z-50 flex flex-col shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h3 className="text-sm font-semibold text-slate-900 truncate">
                {localLeads.find((l) => l.id === selectedLeadId)?.fullName ?? "Lead"}
              </h3>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/ad-campaigns/leads/${selectedLeadId}`}
                  className="text-xs text-court-600 hover:text-court-700 font-medium"
                >
                  Full page
                </Link>
                <button
                  type="button"
                  onClick={() => { setSelectedLeadId(null); setSidebarDetail(null); }}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
                  aria-label="Close sidebar"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-4">
              {sidebarLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="text-sm text-slate-400">Loading…</div>
                </div>
              ) : sidebarDetail ? (
                <LeadManagementPanel
                  lead={sidebarDetail}
                  reps={reps}
                  labelCatalog={labelCatalog}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  onStageUpdated={handleStageUpdated}
                  onLabelsUpdated={handleLabelsUpdated}
                />
              ) : null}
            </div>
          </aside>
        </>
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
    </>
  );
}
