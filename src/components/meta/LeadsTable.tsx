"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import { useToast } from "@/components/Toast";
import MoveToCrmDialog, { type Rep } from "@/components/meta/MoveToCrmDialog";
import LeadManagementPanel from "@/components/meta/LeadManagementPanel";
import AddToGroupDialog from "@/components/meta/AddToGroupDialog";
import type { MetaLeadRow, MetaLeadDetail, MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import { labelChip, labelDot, stageLabelFromRow, stageChipFromRow, type MetaLeadStageRow } from "@/lib/meta-ads/lead-fields";
import { DropdownFilter, type DropdownOption } from "@/components/DropdownFilter";
import { START_TIME_ORDER } from "@/lib/meta-ads/fieldMap";

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

function leadCount(n: number): string {
  return `${n} lead${n === 1 ? "" : "s"}`;
}

export default function LeadsTable({
  leads: serverLeads,
  reps,
  showCampaignColumn,
  exportFilename,
  labelCatalog = [],
  stageCatalog = [],
  currentUserId = "",
  isAdmin = false,
  canBulkAssign = false,
}: {
  leads: MetaLeadRow[];
  reps: Rep[];
  showCampaignColumn: boolean;
  exportFilename: string;
  labelCatalog?: MetaLeadLabelChip[];
  stageCatalog?: MetaLeadStageRow[];
  currentUserId?: string;
  isAdmin?: boolean;
  // Admins and managers: show "Assign to rep" for ticked leads.
  canBulkAssign?: boolean;
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
  function readSavedFilters(): { city: string; sport: string; area: string; stage: string; assigned?: string; label?: string; start?: string } {
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
  const [assignedQuery, setAssignedQuery] = useState(saved.assigned ?? "");
  const [labelFilter, setLabelFilter] = useState(saved.label ?? "");
  const [startFilter, setStartFilter] = useState(saved.start ?? "");

  // Persist filters to sessionStorage on change
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ city: cityQuery, sport: sportQuery, area: areaQuery, stage: stageFilter, assigned: assignedQuery, label: labelFilter, start: startFilter }));
    } catch { /* ignore */ }
  }, [cityQuery, sportQuery, areaQuery, stageFilter, assignedQuery, labelFilter, startFilter, storageKey]);

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

  // --- Ticked leads (bulk assign / add to group) ---------------------------
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  // Shift-click ticks every row between the last tick and this one.
  const lastPickedIndexRef = useRef<number | null>(null);
  const shiftHeldRef = useRef(false);

  function clearPicked() {
    setPickedIds(new Set());
    setAssignOpen(false);
    setAssignTo("");
    lastPickedIndexRef.current = null;
  }

  async function applyBulkAssign() {
    if (!assignTo) return;
    const ids = [...pickedIds];
    const assignedToUserId = assignTo === "__none" ? null : assignTo;
    setAssigning(true);
    try {
      const res = await fetch("/api/ad-campaigns/leads/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids, assignedToUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ? String(data.error) : "Could not assign the leads");
        return;
      }
      const name: string | null = data.assignedToName ?? null;
      setLocalChanges((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { ...next[id], assignedToName: name };
        return next;
      });
      toast.success(name ? `${leadCount(ids.length)} assigned to ${name}` : `Rep removed from ${leadCount(ids.length)}`);
      setAssignOpen(false);
      setAssignTo("");
      // The open side panel shows "Assigned to" — reload it quietly if it's one of these.
      if (selectedLeadId && ids.includes(selectedLeadId)) {
        fetch(`/api/ad-campaigns/leads/${selectedLeadId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d) setSidebarDetail((cur) => (cur && cur.id === d.id ? d : cur));
          })
          .catch(() => {});
      }
      router.refresh();
    } catch {
      toast.error("Could not assign the leads");
    } finally {
      setAssigning(false);
    }
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
  const asq = assignedQuery.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      localLeads.filter((l) => {
        const cityOk = !cq || (l.city ?? "").toLowerCase().includes(cq);
        const sportOk = !sq || (l.sport ?? "").toLowerCase().includes(sq);
        const areaOk = !aq || (l.area ?? "").toLowerCase().includes(aq);
        const stageOk = !stageFilter || l.stage === stageFilter;
        const assignedName = l.assignedToName ?? "Unassigned";
        const assignedOk = !asq || assignedName.toLowerCase().includes(asq);
        const labelOk = !labelFilter || l.labels.some((lb) => lb.name === labelFilter);
        // Exact match — "1–3 months" must not also catch "Within 3 months".
        const startOk = !startFilter || l.startTime === startFilter;
        return cityOk && sportOk && areaOk && stageOk && assignedOk && labelOk && startOk;
      }),
    [localLeads, cq, sq, aq, stageFilter, asq, labelFilter, startFilter],
  );

  const allCities = useMemo(() => tally(localLeads, (l) => l.city), [localLeads]);
  const allSports = useMemo(() => tally(localLeads, (l) => l.sport), [localLeads]);
  const allAreas = useMemo(() => tally(localLeads, (l) => l.area), [localLeads]);
  const allAssigned = useMemo(() => tally(localLeads, (l) => l.assignedToName ?? "Unassigned"), [localLeads]);
  const allLabels: DropdownOption[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of localLeads) {
      for (const lb of l.labels) {
        m.set(lb.name, (m.get(lb.name) ?? 0) + 1);
      }
    }
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [localLeads]);
  // Start-time answers, soonest first (any unfamiliar answer goes last).
  const allStartTimes: DropdownOption[] = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of localLeads) if (l.startTime) m.set(l.startTime, (m.get(l.startTime) ?? 0) + 1);
    const rank = (s: string) => {
      const i = START_TIME_ORDER.indexOf(s);
      return i < 0 ? START_TIME_ORDER.length : i;
    };
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => rank(a.label) - rank(b.label) || b.count - a.count);
  }, [localLeads]);
  const cityBreakdown = useMemo(() => tally(filtered, (l) => l.city), [filtered]);
  const sportBreakdown = useMemo(() => tally(filtered, (l) => l.sport), [filtered]);
  const areaBreakdown = useMemo(() => tally(filtered, (l) => l.area), [filtered]);
  const assignedBreakdown = useMemo(() => tally(filtered, (l) => l.assignedToName ?? "Unassigned"), [filtered]);

  const hasFilter = !!(cityQuery || sportQuery || areaQuery || stageFilter || assignedQuery || labelFilter || startFilter);

  // Ticks only ever cover rows on screen: a filter change drops ticked leads it
  // hides, so a bulk action never reaches a lead the user can't see.
  useEffect(() => {
    setPickedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filtered.map((l) => l.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
    lastPickedIndexRef.current = null;
  }, [filtered]);

  const allPicked = filtered.length > 0 && filtered.every((l) => pickedIds.has(l.id));
  const somePicked = pickedIds.size > 0 && !allPicked;

  function toggleAllPicked() {
    setPickedIds(allPicked ? new Set() : new Set(filtered.map((l) => l.id)));
    lastPickedIndexRef.current = null;
  }

  function togglePicked(index: number) {
    const lead = filtered[index];
    if (!lead) return;
    const select = !pickedIds.has(lead.id);
    const last = lastPickedIndexRef.current;
    const range = shiftHeldRef.current && last !== null && last !== index;
    setPickedIds((prev) => {
      const next = new Set(prev);
      const [from, to] = range ? [Math.min(last!, index), Math.max(last!, index)] : [index, index];
      for (let i = from; i <= to; i++) {
        const id = filtered[i]?.id;
        if (!id) continue;
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    lastPickedIndexRef.current = index;
    shiftHeldRef.current = false;
  }

  const checkboxCls = "h-4 w-4 rounded border-slate-300 text-court-600 focus:ring-court-500 cursor-pointer";

  const headers = [
    "Name", "Phone", "Email", "City", "Sport", "Area", "Start", "Form",
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
    stageLabelFromRow(l.stage, stageCatalog),
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
        <div className="flex flex-wrap items-end gap-3" data-guide="wa-ad-filters">
          <DropdownFilter guide="wa-ad-city" label="City" value={cityQuery} onChange={setCityQuery} options={allCities.filter((c) => c.label !== "—")} />
          <DropdownFilter guide="wa-ad-sport" label="Sport" value={sportQuery} onChange={setSportQuery} options={allSports.filter((s) => s.label !== "—")} />
          <DropdownFilter label="Area" value={areaQuery} onChange={setAreaQuery} options={allAreas.filter((a) => a.label !== "—")} />
          {allStartTimes.length > 0 && (
            <DropdownFilter guide="wa-ad-start" label="Start time" value={startFilter} onChange={setStartFilter} options={allStartTimes} />
          )}
          <div data-guide="wa-ad-stage">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Stage</label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="input w-40 text-sm"
            >
              <option value="">All stages</option>
              {stageCatalog.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <DropdownFilter guide="wa-ad-assigned" label="Assigned To" value={assignedQuery} onChange={setAssignedQuery} options={allAssigned} />
          {allLabels.length > 0 && (
            <DropdownFilter label="Label" value={labelFilter} onChange={setLabelFilter} options={allLabels} />
          )}
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
                setAssignedQuery("");
                setLabelFilter("");
                setStartFilter("");
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
          <BreakdownList
            title="Leads by assigned to"
            items={assignedBreakdown}
            activeKey={asq}
            onPick={(label) => setAssignedQuery((v) => (v.trim().toLowerCase() === label.toLowerCase() ? "" : label))}
          />
        </div>

        {/* Ticked leads → bulk actions */}
        {pickedIds.size > 0 && (
          <div
            className="sticky top-0 z-20 bg-court-700 text-white rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 shadow-lg"
            data-guide="wa-ad-bulk-bar"
          >
            <span className="font-medium text-sm">{pickedIds.size} selected</span>
            <button type="button" onClick={clearPicked} className="text-xs underline opacity-80 hover:opacity-100">
              Clear
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-2 flex-wrap">
              {canBulkAssign &&
                (assignOpen ? (
                  <div className="flex items-center gap-2 bg-white text-slate-900 rounded-md px-2 py-1.5">
                    <select
                      value={assignTo}
                      onChange={(e) => setAssignTo(e.target.value)}
                      aria-label="Rep to assign"
                      className="text-sm border border-slate-200 rounded px-1.5 py-1 max-w-[12rem]"
                      autoFocus
                    >
                      <option value="">Choose a rep…</option>
                      {reps.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                      <option value="__none">Unassigned (remove rep)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void applyBulkAssign()}
                      disabled={!assignTo || assigning}
                      className="text-xs font-medium bg-court-600 hover:bg-court-700 text-white px-2.5 py-1 rounded disabled:opacity-50"
                    >
                      {assigning ? "Assigning…" : "Assign"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignOpen(false);
                        setAssignTo("");
                      }}
                      aria-label="Cancel assigning"
                      className="text-xs text-slate-500 hover:text-slate-800 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAssignOpen(true)}
                    data-guide="wa-ad-bulk-assign"
                    className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
                  >
                    👤 Assign to rep
                  </button>
                ))}
              <button
                type="button"
                onClick={() => setGroupDialogOpen(true)}
                data-guide="wa-ad-bulk-group"
                className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
              >
                👥 Add to group
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400">No leads match the current filters.</p>
        ) : (
          <>
          {/* Mobile: select all */}
          <label className="md:hidden flex items-center gap-2 px-1 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={allPicked}
              ref={(el) => {
                if (el) el.indeterminate = somePicked;
              }}
              onChange={toggleAllPicked}
              className={checkboxCls}
            />
            Select all {filtered.length}
          </label>

          {/* Mobile cards */}
          <div className="md:hidden border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
            {filtered.map((l, i) => (
              <div
                key={l.id}
                onClick={() => handleRowClick(l)}
                className={`p-4 cursor-pointer transition-colors ${
                  selectedLeadId === l.id
                    ? "bg-court-50 border-l-2 border-l-court-500"
                    : pickedIds.has(l.id)
                      ? "bg-court-50"
                      : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <input
                    type="checkbox"
                    checked={pickedIds.has(l.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      shiftHeldRef.current = e.shiftKey;
                    }}
                    onChange={() => togglePicked(i)}
                    aria-label={`Select ${l.fullName ?? "lead"}`}
                    className={`${checkboxCls} mt-0.5 shrink-0`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-slate-900 truncate">{l.fullName ?? "—"}</span>
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
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {l.phone ?? "—"} · {l.formName ?? "—"}
                    </div>
                  </div>
                  <span className={`shrink-0 badge ${stageChipFromRow(l.stage, stageCatalog)}`}>
                    {stageLabelFromRow(l.stage, stageCatalog)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <div className="truncate">
                    {new Date(l.capturedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </div>
                  {showCampaignColumn && <div className="truncate">{l.campaignName ?? "—"}</div>}
                  <div className="truncate">{l.city ?? "—"}</div>
                  <div className="truncate">{l.sport ?? "—"}</div>
                  {l.startTime && <div className="truncate">Starts: {l.startTime}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8 !pr-0">
                    <input
                      type="checkbox"
                      checked={allPicked}
                      ref={(el) => {
                        if (el) el.indeterminate = somePicked;
                      }}
                      onChange={toggleAllPicked}
                      aria-label={allPicked ? "Unselect all leads" : `Select all ${filtered.length} leads`}
                      title={allPicked ? "Unselect all" : `Select all ${filtered.length} leads shown`}
                      data-guide="wa-ad-select-all"
                      className={checkboxCls}
                    />
                  </th>
                  {headers.map((h, i) => (
                    <th key={i} className={`whitespace-nowrap ${h === "CRM" ? "!text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l, i) => (
                  <tr
                    key={l.id}
                    onClick={() => handleRowClick(l)}
                    className={`cursor-pointer transition-colors ${
                      selectedLeadId === l.id
                        ? "bg-court-50 border-l-2 border-l-court-500"
                        : pickedIds.has(l.id)
                          ? "bg-court-50"
                          : "hover:bg-slate-50"
                    }`}
                  >
                    <td className="w-8 !pr-0" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={pickedIds.has(l.id)}
                        onClick={(e) => {
                          shiftHeldRef.current = e.shiftKey;
                        }}
                        onChange={() => togglePicked(i)}
                        aria-label={`Select ${l.fullName ?? "lead"}`}
                        className={checkboxCls}
                      />
                    </td>
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
                    <td className="whitespace-nowrap text-slate-700">{l.startTime ?? "—"}</td>
                    <td className="whitespace-nowrap text-slate-700">{l.formName ?? "—"}</td>
                    {showCampaignColumn && (
                      <td className="whitespace-nowrap text-slate-700">{l.campaignName ?? "—"}</td>
                    )}
                    <td className="whitespace-nowrap">
                      <span className={`badge ${stageChipFromRow(l.stage, stageCatalog)}`}>
                        {stageLabelFromRow(l.stage, stageCatalog)}
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
          </>
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
                  stageCatalog={stageCatalog}
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

      {groupDialogOpen && (
        <AddToGroupDialog
          leadIds={[...pickedIds]}
          onClose={() => setGroupDialogOpen(false)}
          onDone={() => setGroupDialogOpen(false)}
        />
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
