"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { downloadCsv, downloadXlsx } from "@/lib/analytics/export";
import { useToast } from "@/components/Toast";
import MoveToCrmDialog, { type Rep } from "@/components/meta/MoveToCrmDialog";
import LeadManagementPanel from "@/components/meta/LeadManagementPanel";
import AddToGroupDialog from "@/components/meta/AddToGroupDialog";
import type { MetaLeadRow, MetaLeadDetail, MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import type { LeadBreakdown, LeadExportRow, LeadListInitial, LeadTally } from "@/lib/meta-ads/lead-list";
import { labelChip, labelDot, stageLabelFromRow, stageChipFromRow, type MetaLeadStageRow } from "@/lib/meta-ads/lead-fields";
import { DropdownFilter } from "@/components/DropdownFilter";

function BreakdownList({
  title,
  items,
  activeKey,
  onPick,
}: {
  title: string;
  items: LeadTally[];
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

type Filters = {
  city: string;
  sport: string;
  area: string;
  start: string;
  stage: string;
  assigned: string;
  label: string;
};
const NO_FILTERS: Filters = { city: "", sport: "", area: "", start: "", stage: "", assigned: "", label: "" };
const NO_FILTERS_KEY = JSON.stringify(NO_FILTERS);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function leadCount(n: number): string {
  return `${n} lead${n === 1 ? "" : "s"}`;
}

const exportBtnCls =
  "inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-60";

export default function LeadsTable({
  initial,
  range,
  campaignId,
  reps,
  showCampaignColumn,
  exportFilename,
  labelCatalog = [],
  stageCatalog = [],
  currentUserId = "",
  isAdmin = false,
  canBulkAssign = false,
  refreshToken = 0,
}: {
  // First page + dropdown options, rendered by the server; every later page,
  // filter and breakdown comes from /api/ad-campaigns/leads.
  initial: LeadListInitial;
  range: { from: string; to: string };
  // Raw Meta campaign id when this table is one campaign's leads tab.
  campaignId?: string;
  reps: Rep[];
  showCampaignColumn: boolean;
  exportFilename: string;
  labelCatalog?: MetaLeadLabelChip[];
  stageCatalog?: MetaLeadStageRow[];
  currentUserId?: string;
  isAdmin?: boolean;
  // Admins and managers: show "Assign to rep" for ticked leads.
  canBulkAssign?: boolean;
  // Bump to quietly reload the current page (the parent does this after "Sync leads").
  refreshToken?: number;
}) {
  const toast = useToast();
  const [movingLead, setMovingLead] = useState<MetaLeadRow | null>(null);
  const [marketingBusyId, setMarketingBusyId] = useState<string | null>(null);

  // --- The list: one server-backed page at a time ---------------------------
  const [rows, setRows] = useState<MetaLeadRow[]>(initial.rows);
  const [total, setTotal] = useState(initial.total); // leads matching the filters, all pages
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState(initial.options); // dropdown choices (whole window / campaign)
  // With no filter set, the breakdown is the same numbers as the options.
  const [breakdown, setBreakdown] = useState<LeadBreakdown>({
    city: initial.options.city,
    sport: initial.options.sport,
    area: initial.options.area,
    assigned: initial.options.assigned,
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const maxSelectable = initial.maxSelectable;
  const tableTopRef = useRef<HTMLDivElement>(null);

  // Per-lead field overrides for changes made here (sidebar stage / labels, bulk
  // assign, move to CRM) so the row shows them straight away; the next page load
  // brings the server's version and clears them.
  const [localChanges, setLocalChanges] = useState<Record<string, Partial<MetaLeadRow>>>({});
  const changeSeqRef = useRef(0);
  const patchLocal = useCallback((ids: string[], patch: Partial<MetaLeadRow>) => {
    changeSeqRef.current += 1;
    setLocalChanges((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { ...next[id], ...patch };
      return next;
    });
  }, []);
  const leads = useMemo(
    () => rows.map((l) => (localChanges[l.id] ? { ...l, ...localChanges[l.id] } : l)),
    [rows, localChanges],
  );

  // --- Filters (kept in sessionStorage, restored after mount, then fetched) ---
  const storageKey = FILTER_STORAGE_PREFIX + exportFilename;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [ready, setReady] = useState(false);
  const skipDebounceRef = useRef(false);

  useEffect(() => {
    let saved: Record<string, unknown> = {};
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw) ?? {};
    } catch { /* ignore */ }
    const restored: Filters = {
      city: str(saved.city),
      sport: str(saved.sport),
      area: str(saved.area),
      start: str(saved.start),
      stage: str(saved.stage),
      assigned: str(saved.assigned),
      label: str(saved.label),
    };
    if (JSON.stringify(restored) !== NO_FILTERS_KEY) {
      skipDebounceRef.current = true;
      setFilters(restored);
      setLoading(true);
    }
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(filters));
    } catch { /* ignore */ }
  }, [filters, ready, storageKey]);

  // --- Loading pages ---------------------------------------------------------
  const fetchSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const refreshedAtRef = useRef(Date.now());
  const loadedRef = useRef({ filterKey: NO_FILTERS_KEY, page: 1, nonce: 0 });
  const [nonce, setNonce] = useState(0);
  const quietNonceRef = useRef(true);
  // Reload the current page again (and the breakdown + dropdown options).
  const refetch = useCallback((quiet: boolean) => {
    quietNonceRef.current = quiet;
    setNonce((n) => n + 1);
  }, []);

  const query = useCallback(
    (f: Filters, extra: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      if (range.from) p.set("from", range.from);
      if (range.to) p.set("to", range.to);
      if (campaignId) p.set("campaign", campaignId);
      for (const k of Object.keys(f) as (keyof Filters)[]) if (f[k]) p.set(k, f[k]);
      for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p.toString();
    },
    [range.from, range.to, campaignId],
  );

  const loadPage = useCallback(
    async (target: { page: number; filters: Filters; withBreakdown: boolean; withOptions: boolean; quiet: boolean }) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const seq = ++fetchSeqRef.current;
      const changesAtStart = changeSeqRef.current;
      if (!target.quiet) {
        setLoading(true);
        setLoadError(false);
      }
      try {
        const extra: Record<string, string> = { page: String(target.page) };
        if (target.withBreakdown) extra.facets = "1";
        if (target.withOptions) extra.options = "1";
        const res = await fetch(`/api/ad-campaigns/leads?${query(target.filters, extra)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (seq !== fetchSeqRef.current) return; // a newer request has taken over
        setRows(data.rows);
        setTotal(data.total);
        setPageCount(data.pageCount);
        if (data.page !== target.page) {
          loadedRef.current = { ...loadedRef.current, page: data.page };
          setPage(data.page);
        }
        if (data.breakdown) setBreakdown(data.breakdown);
        if (data.options) setOptions(data.options);
        // The server's version is current — drop the local overrides unless one was made meanwhile.
        if (changeSeqRef.current === changesAtStart) setLocalChanges({});
        refreshedAtRef.current = Date.now();
        setLoadError(false);
      } catch (err) {
        if (seq !== fetchSeqRef.current || (err instanceof DOMException && err.name === "AbortError")) return;
        if (!target.quiet) setLoadError(true);
      } finally {
        if (seq === fetchSeqRef.current) setLoading(false);
      }
    },
    [query],
  );

  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    if (!ready) return;
    const last = loadedRef.current;
    const filtersChanged = filterKey !== last.filterKey;
    const forced = nonce !== last.nonce;
    if (!filtersChanged && !forced && page === last.page) return; // the screen already shows this
    // Typing / picking filters waits a moment; paging and reloads go straight out.
    const delay = filtersChanged && !skipDebounceRef.current ? 300 : 0;
    const t = setTimeout(() => {
      skipDebounceRef.current = false;
      loadedRef.current = { filterKey, page, nonce };
      void loadPage({
        page,
        filters,
        withBreakdown: filtersChanged || forced,
        withOptions: forced,
        quiet: forced && !filtersChanged && quietNonceRef.current,
      });
    }, delay);
    return () => clearTimeout(t);
  }, [ready, filterKey, page, nonce, filters, loadPage]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The parent bumps refreshToken after "Sync leads".
  const firstTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === firstTokenRef.current) return;
    firstTokenRef.current = refreshToken;
    refetch(true);
  }, [refreshToken, refetch]);

  // Reload quietly when the tab becomes visible again (picks up stage/label
  // changes made on the detail page). Uses visibilitychange (hidden→visible)
  // instead of focus to avoid firing on every click — and only when the data is
  // over a minute old.
  const wasHiddenRef = useRef(false);
  useEffect(() => {
    function onVisChange() {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
      } else if (wasHiddenRef.current) {
        wasHiddenRef.current = false;
        if (Date.now() - refreshedAtRef.current < 60_000) return;
        refreshedAtRef.current = Date.now();
        refetch(true);
      }
    }
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [refetch]);

  // Sidebar state
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [sidebarDetail, setSidebarDetail] = useState<MetaLeadDetail | null>(null);
  const [sidebarLoading, setSidebarLoading] = useState(false);

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
    patchLocal([leadId], { stage: newStage });
    if (filters.stage) refetch(true); // the lead may no longer match the stage filter
  }

  function handleLabelsUpdated(leadId: string, labels: MetaLeadLabelChip[]) {
    patchLocal([leadId], { labels });
    if (filters.label) refetch(true);
  }

  // --- Ticked leads (bulk assign / add to group) ---------------------------
  // Ticks live across pages; a filter change clears them.
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false); // "Select all N matching" was used
  const [selectingAll, setSelectingAll] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  // Shift-click ticks every row between the last tick and this one.
  const lastPickedIndexRef = useRef<number | null>(null);
  const shiftHeldRef = useRef(false);

  function clearPicked() {
    setPickedIds(new Set());
    setAllMatching(false);
    setAssignOpen(false);
    setAssignTo("");
    lastPickedIndexRef.current = null;
  }

  // Every filter change starts again from page 1 with nothing ticked, so a bulk
  // action never reaches a lead the filters no longer show.
  function changeFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    clearPicked();
  }

  function goToPage(next: number) {
    lastPickedIndexRef.current = null;
    setPage(next);
    tableTopRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
      patchLocal(ids, { assignedToName: name });
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
      refetch(true);
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

  const cq = filters.city.trim().toLowerCase();
  const sq = filters.sport.trim().toLowerCase();
  const aq = filters.area.trim().toLowerCase();
  const asq = filters.assigned.trim().toLowerCase();
  const hasFilter = Object.values(filters).some(Boolean);

  const allPicked = leads.length > 0 && leads.every((l) => pickedIds.has(l.id));
  const somePicked = !allPicked && leads.some((l) => pickedIds.has(l.id));

  // The header box ticks / unticks the rows on this page; ticks on other pages stay.
  function toggleAllPicked() {
    setPickedIds((prev) => {
      const next = new Set(prev);
      for (const l of leads) {
        if (allPicked) next.delete(l.id);
        else next.add(l.id);
      }
      return next;
    });
    setAllMatching(false);
    lastPickedIndexRef.current = null;
  }

  function togglePicked(index: number) {
    const lead = leads[index];
    if (!lead) return;
    const select = !pickedIds.has(lead.id);
    const last = lastPickedIndexRef.current;
    const isRun = shiftHeldRef.current && last !== null && last !== index;
    setPickedIds((prev) => {
      const next = new Set(prev);
      const [from, to] = isRun ? [Math.min(last!, index), Math.max(last!, index)] : [index, index];
      for (let i = from; i <= to; i++) {
        const id = leads[i]?.id;
        if (!id) continue;
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setAllMatching(false);
    lastPickedIndexRef.current = index;
    shiftHeldRef.current = false;
  }

  // "Select all N matching": ticks every lead the filters find, beyond this page.
  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const res = await fetch(`/api/ad-campaigns/leads?${query(filters, { idsOnly: "1" })}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPickedIds(new Set(data.ids as string[]));
      setAllMatching(true);
    } catch {
      toast.error("Could not select them all — try again");
    } finally {
      setSelectingAll(false);
    }
  }

  const selectionNote =
    total > leads.length ? (
      allMatching && pickedIds.size >= total ? (
        <span className="text-xs opacity-90">All {total.toLocaleString()} matching are selected</span>
      ) : allPicked ? (
        total > maxSelectable ? (
          <span className="text-xs opacity-90">
            Too many to select at once — narrow the filters to {maxSelectable.toLocaleString()} or fewer.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void selectAllMatching()}
            disabled={selectingAll}
            className="text-xs font-semibold underline hover:opacity-90 disabled:opacity-60"
          >
            {selectingAll ? "Selecting…" : `Select all ${total.toLocaleString()} matching`}
          </button>
        )
      ) : null
    ) : null;

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

  // Export covers every lead the filters find (not just this page): the rows are
  // fetched on click, then handed to the shared CSV / XLSX download helpers.
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  async function runExport(kind: "csv" | "xlsx") {
    if (exporting) return;
    setExporting(kind);
    try {
      const res = await fetch(`/api/ad-campaigns/leads?${query(filters, { export: "1" })}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { rows: LeadExportRow[]; total: number; capped: boolean };
      const exportRows: (string | number)[][] = data.rows.map((l) => [
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
      if (kind === "csv") downloadCsv(exportFilename, exportHeaders, exportRows);
      else await downloadXlsx(exportFilename, exportHeaders, exportRows);
      if (data.capped) {
        toast.info(`Exported the first ${data.rows.length.toLocaleString()} of ${data.total.toLocaleString()} leads.`);
      }
    } catch {
      toast.error("Could not export the leads");
    } finally {
      setExporting(null);
    }
  }

  if (options.total === 0 && total === 0 && leads.length === 0) {
    return <p className="text-sm text-slate-400">No leads captured in this range.</p>;
  }

  const inputCls = "input w-44 text-sm";
  const sidebarOpen = !!selectedLeadId;

  return (
    <>
      <div className="space-y-3">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3" data-guide="wa-ad-filters">
          <DropdownFilter guide="wa-ad-city" label="City" value={filters.city} onChange={(v) => changeFilters({ city: v })} options={options.city.filter((c) => c.label !== "—")} />
          <DropdownFilter guide="wa-ad-sport" label="Sport" value={filters.sport} onChange={(v) => changeFilters({ sport: v })} options={options.sport.filter((s) => s.label !== "—")} />
          <DropdownFilter label="Area" value={filters.area} onChange={(v) => changeFilters({ area: v })} options={options.area.filter((a) => a.label !== "—")} />
          {options.startTimes.length > 0 && (
            <DropdownFilter guide="wa-ad-start" label="Start time" value={filters.start} onChange={(v) => changeFilters({ start: v })} options={options.startTimes} />
          )}
          <div data-guide="wa-ad-stage">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Stage</label>
            <select
              value={filters.stage}
              onChange={(e) => changeFilters({ stage: e.target.value })}
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
          <DropdownFilter guide="wa-ad-assigned" label="Assigned To" value={filters.assigned} onChange={(v) => changeFilters({ assigned: v })} options={options.assigned} />
          {options.labels.length > 0 && (
            <DropdownFilter label="Label" value={filters.label} onChange={(v) => changeFilters({ label: v })} options={options.labels} />
          )}
          <div className="text-xs text-slate-500 pb-1.5">
            Showing <b className="text-slate-800 font-mono">{total}</b> of <span className="font-mono">{options.total}</span>
            {hasFilter && <span className="text-slate-400"> (filtered)</span>}
          </div>
          {hasFilter && (
            <button
              type="button"
              onClick={() => changeFilters(NO_FILTERS)}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 underline pb-1.5"
            >
              Clear
            </button>
          )}
          <div className="ml-auto flex gap-2 text-xs">
            <button type="button" onClick={() => void runExport("csv")} disabled={!!exporting} className={exportBtnCls}>
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button type="button" onClick={() => void runExport("xlsx")} disabled={!!exporting} className={exportBtnCls}>
              {exporting === "xlsx" ? "Exporting…" : "Export XLSX"}
            </button>
          </div>
        </div>

        {/* Breakdown — click a value to filter by it */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <BreakdownList
            title="Leads by city"
            items={breakdown.city}
            activeKey={cq}
            onPick={(label) => changeFilters({ city: filters.city.trim().toLowerCase() === label.toLowerCase() ? "" : label })}
          />
          <BreakdownList
            title="Leads by sport"
            items={breakdown.sport}
            activeKey={sq}
            onPick={(label) => changeFilters({ sport: filters.sport.trim().toLowerCase() === label.toLowerCase() ? "" : label })}
          />
          <BreakdownList
            title="Leads by area"
            items={breakdown.area}
            activeKey={aq}
            onPick={(label) => changeFilters({ area: filters.area.trim().toLowerCase() === label.toLowerCase() ? "" : label })}
          />
          <BreakdownList
            title="Leads by assigned to"
            items={breakdown.assigned}
            activeKey={asq}
            onPick={(label) => changeFilters({ assigned: filters.assigned.trim().toLowerCase() === label.toLowerCase() ? "" : label })}
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
            {selectionNote}
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
        <div ref={tableTopRef} className={loading ? "opacity-60 transition-opacity" : ""}>
        {loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>Couldn&apos;t load these leads. Try again</span>
            <button type="button" onClick={() => refetch(false)} className="btn btn-secondary !px-2.5 !py-1 !text-xs">
              Try again
            </button>
          </div>
        ) : total === 0 ? (
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
            Select all {leads.length} on this page
          </label>

          {/* Mobile cards */}
          <div className="md:hidden border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
            {leads.map((l, i) => (
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
                      aria-label={allPicked ? "Unselect all leads" : `Select all ${leads.length} leads`}
                      title={allPicked ? "Unselect all" : `Select all ${leads.length} on this page`}
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
                {leads.map((l, i) => (
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

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || loading}
                className="btn btn-secondary"
              >
                Previous
              </button>
              <span aria-hidden className="text-slate-300">·</span>
              <span className="text-sm text-slate-500">
                Page <span className="font-mono">{page}</span> of{" "}
                <span className="font-mono">{pageCount}</span>
              </span>
              <span aria-hidden className="text-slate-300">·</span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= pageCount || loading}
                className="btn btn-secondary"
              >
                Next
              </button>
            </div>
          )}
          </>
        )}
        </div>
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
                {sidebarDetail?.fullName ?? leads.find((l) => l.id === selectedLeadId)?.fullName ?? "Lead"}
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
            patchLocal([movingLead.id], { inCrm: true });
            setMovingLead(null);
            refetch(true);
          }}
        />
      )}
    </>
  );
}
