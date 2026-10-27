"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { downloadCsv, downloadXlsx } from "@/lib/analytics/export";
import { useToast } from "@/components/Toast";
import { DropdownFilter } from "@/components/DropdownFilter";
import AddToGroupDialog from "@/components/meta/AddToGroupDialog";
import type { Rep } from "@/components/meta/MoveToCrmDialog";
import { labelChip, labelDot, stageChipFromRow, stageLabelFromRow, type MetaLeadStageRow } from "@/lib/meta-ads/lead-fields";
import { fmtDateTimeIST, fmtShortDateTimeIST } from "@/lib/time";
import type {
  WebsiteLeadExportRow,
  WebsiteLeadOptions,
  WebsiteLeadPage,
  WebsiteLeadRow,
} from "@/lib/website-leads/list";
import { CameFromChip, LeadBadges, courtAreaText, courtSizeText } from "./shared";

// The Website leads table: the server renders page 1 and the dropdown options;
// every later page, filter, "Select all N matching" and the export come from
// /api/website-leads. Same behaviour as the ad leads table (LeadsTable.tsx):
// filters are remembered for the browser session, ticks live across pages and a
// filter change clears them so a bulk action never reaches a lead that isn't shown.

const FILTER_STORAGE_KEY = "website-leads-filter";

type Filters = {
  city: string;
  sport: string;
  areaMin: string;
  areaMax: string;
  stage: string;
  assigned: string; // "", "unassigned" or a rep's user id
  label: string;
  cameFrom: string; // a "Came from" label such as "ChatGPT", or "Unknown"
  q: string;
};
const NO_FILTERS: Filters = { city: "", sport: "", areaMin: "", areaMax: "", stage: "", assigned: "", label: "", cameFrom: "", q: "" };
const NO_FILTERS_KEY = JSON.stringify(NO_FILTERS);
const FILTER_KEYS = Object.keys(NO_FILTERS) as (keyof Filters)[];
const str = (v: unknown) => (typeof v === "string" ? v : "");
const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 9);

function leadCount(n: number): string {
  return `${n} lead${n === 1 ? "" : "s"}`;
}

const exportBtnCls =
  "inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-60";
const checkboxCls = "h-4 w-4 rounded border-slate-300 text-court-600 focus:ring-court-500 cursor-pointer";

function LabelChips({ labels }: { labels: WebsiteLeadRow["labels"] }) {
  if (labels.length === 0) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((lb) => (
        <span
          key={lb.id}
          className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${labelChip(lb.color)}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${labelDot(lb.color)}`} />
          {lb.name}
        </span>
      ))}
    </div>
  );
}

export default function WebsiteLeadsTable({
  initial,
  range,
  reps,
  stageCatalog,
  canBulkAssign,
}: {
  initial: WebsiteLeadPage & { options: WebsiteLeadOptions };
  range: { from: string; to: string };
  reps: Rep[];
  stageCatalog: MetaLeadStageRow[];
  // Admins and managers: show "Assign to rep" for ticked leads.
  canBulkAssign: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  // --- The list: one server-backed page at a time ---------------------------
  const [rows, setRows] = useState<WebsiteLeadRow[]>(initial.rows);
  const [total, setTotal] = useState(initial.total); // leads matching the filters, all pages
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState(initial.options); // dropdown choices (whole date window)
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const maxSelectable = initial.maxSelectable;
  const tableTopRef = useRef<HTMLDivElement>(null);

  // Per-lead overrides for changes made here (bulk assign) so the row shows them
  // straight away; the next page load brings the server's version and clears them.
  const [localChanges, setLocalChanges] = useState<Record<string, Partial<WebsiteLeadRow>>>({});
  const changeSeqRef = useRef(0);
  const patchLocal = useCallback((ids: string[], patch: Partial<WebsiteLeadRow>) => {
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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [ready, setReady] = useState(false);
  const skipDebounceRef = useRef(false);
  // Phones only: the filters under the search box fold away until "Filters" is tapped.
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let saved: Record<string, unknown> = {};
    try {
      const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) ?? {};
    } catch {
      /* ignore */
    }
    const restored = { ...NO_FILTERS };
    for (const k of FILTER_KEYS) restored[k] = str(saved[k]);
    if (JSON.stringify(restored) !== NO_FILTERS_KEY) {
      skipDebounceRef.current = true;
      setFilters(restored);
      setLoading(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters, ready]);

  // --- Loading pages ---------------------------------------------------------
  const fetchSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const refreshedAtRef = useRef(Date.now());
  const loadedRef = useRef({ filterKey: NO_FILTERS_KEY, page: 1, nonce: 0 });
  const [nonce, setNonce] = useState(0);
  const quietNonceRef = useRef(true);
  // Reload the current page again (and the dropdown options).
  const refetch = useCallback((quiet: boolean) => {
    quietNonceRef.current = quiet;
    setNonce((n) => n + 1);
  }, []);

  const query = useCallback(
    (f: Filters, extra: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      if (range.from) p.set("from", range.from);
      if (range.to) p.set("to", range.to);
      for (const k of FILTER_KEYS) if (f[k].trim()) p.set(k, f[k].trim());
      for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p.toString();
    },
    [range.from, range.to],
  );

  const loadPage = useCallback(
    async (target: { page: number; filters: Filters; withOptions: boolean; quiet: boolean }) => {
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
        if (target.withOptions) extra.options = "1";
        const res = await fetch(`/api/website-leads?${query(target.filters, extra)}`, { signal: ctrl.signal });
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
        withOptions: forced,
        quiet: forced && !filtersChanged && quietNonceRef.current,
      });
    }, delay);
    return () => clearTimeout(t);
  }, [ready, filterKey, page, nonce, filters, loadPage]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Reload quietly when the tab becomes visible again (picks up changes made on
  // the detail page), only when the data is over a minute old.
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

  // --- Ticked leads (bulk assign / add to group) ---------------------------
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

  // Every filter change starts again from page 1 with nothing ticked.
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
      const res = await fetch("/api/website-leads/assign", {
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
      patchLocal(ids, { assignedToUserId, assignedToName: name });
      toast.success(name ? `${leadCount(ids.length)} assigned to ${name}` : `Rep removed from ${leadCount(ids.length)}`);
      setAssignOpen(false);
      setAssignTo("");
      refetch(true);
    } catch {
      toast.error("Could not assign the leads");
    } finally {
      setAssigning(false);
    }
  }

  const hasFilter = FILTER_KEYS.some((k) => filters[k].trim() !== "");
  // Shown on the phone "Filters" button: the folded filters in use (search isn't one; min + max court size count once).
  const activeFilterCount =
    [filters.city, filters.sport, filters.stage, filters.assigned, filters.label, filters.cameFrom].filter((v) => v.trim() !== "").length +
    (filters.areaMin.trim() !== "" || filters.areaMax.trim() !== "" ? 1 : 0);
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
      const res = await fetch(`/api/website-leads?${query(filters, { idsOnly: "1" })}`);
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
        <span className="text-xs opacity-90">All {total.toLocaleString("en-IN")} matching are selected</span>
      ) : allPicked ? (
        total > maxSelectable ? (
          <span className="text-xs opacity-90">
            Too many to select at once — narrow the filters to {maxSelectable.toLocaleString("en-IN")} or fewer.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void selectAllMatching()}
            disabled={selectingAll}
            className="text-xs font-semibold underline hover:opacity-90 disabled:opacity-60"
          >
            {selectingAll ? "Selecting…" : `Select all ${total.toLocaleString("en-IN")} matching`}
          </button>
        )
      ) : null
    ) : null;

  // --- Export: every lead the filters find (not just this page) --------------
  const exportHeaders = [
    "Name", "Phone", "Email", "City", "State", "Job title", "Sport", "Length (ft)", "Width (ft)", "Area (sq ft)",
    "Start time", "Page", "Came from", "Campaign", "Landing page", "Customer message", "Stage", "Rep", "Labels", "Received (IST)", "In CRM",
  ];
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  async function runExport(kind: "csv" | "xlsx") {
    if (exporting) return;
    setExporting(kind);
    try {
      const res = await fetch(`/api/website-leads?${query(filters, { export: "1" })}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { rows: WebsiteLeadExportRow[]; total: number; capped: boolean };
      const exportRows: (string | number)[][] = data.rows.map((l) => [
        l.name,
        l.phone,
        l.email ?? "—",
        l.city ?? "—",
        l.state ?? "—",
        l.jobTitle ?? "—",
        l.sport ?? "—",
        l.lengthFt ?? "—",
        l.widthFt ?? "—",
        l.areaSqft ?? "—",
        l.startWhen ?? "—",
        l.surface ?? "—",
        l.cameFrom ?? "Unknown",
        l.campaign ?? "—",
        l.landingPage ?? "—",
        l.notes ?? "—",
        stageLabelFromRow(l.stage, stageCatalog),
        l.assignedToName ?? "Unassigned",
        l.labels || "—",
        fmtDateTimeIST(l.receivedAt),
        l.inCrm ? "In CRM" : "—",
      ]);
      if (kind === "csv") downloadCsv("website-leads", exportHeaders, exportRows);
      else await downloadXlsx("website-leads", exportHeaders, exportRows);
      if (data.capped) {
        toast.info(`Exported the first ${data.rows.length.toLocaleString("en-IN")} of ${data.total.toLocaleString("en-IN")} leads.`);
      }
    } catch {
      toast.error("Could not export the leads");
    } finally {
      setExporting(null);
    }
  }

  if (options.total === 0 && total === 0 && leads.length === 0 && !hasFilter && !loading && !loadError) {
    return <p className="text-sm text-slate-400">No website leads yet</p>;
  }

  const openLead = (id: string) => router.push(`/website-leads/${id}`);
  const labelCls = "block text-[11px] font-medium text-slate-600 mb-1";

  return (
    <>
      <div className="space-y-3">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          {/* min-w keeps the search box on a line of its own width: with flex-1 and min-w-0 its wrapping size is 0, so the Filters button, count and Clear would all squeeze onto its line. */}
          <div className="min-w-[9rem] flex-1 sm:w-56 sm:flex-none">
            <label htmlFor="wl-search" className={labelCls}>Search</label>
            <input
              id="wl-search"
              type="search"
              value={filters.q}
              onChange={(e) => changeFilters({ q: e.target.value })}
              placeholder="Name, phone or email"
              className="input w-full text-sm"
            />
          </div>
          {/* Phones: the other filters fold behind this button (CSS only, so no hydration mismatch). */}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls="wl-filter-panel"
            className="btn btn-secondary md:hidden"
          >
            {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
            <svg className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${filtersOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {/* md and up: display:contents, so these sit in the row beside the search box exactly as before. */}
          <div
            id="wl-filter-panel"
            className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-end gap-3 md:contents`}
          >
            <DropdownFilter label="City" value={filters.city} onChange={(v) => changeFilters({ city: v })} options={options.city.filter((c) => c.label !== "—")} />
            <DropdownFilter label="Sport" value={filters.sport} onChange={(v) => changeFilters({ sport: v })} options={options.sport.filter((s) => s.label !== "—")} />
            <div>
              <span className={labelCls}>Court size (sq ft)</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={filters.areaMin}
                  onChange={(e) => changeFilters({ areaMin: digitsOnly(e.target.value) })}
                  placeholder="Min"
                  aria-label="Smallest court size in sq ft"
                  className="input w-20 text-sm"
                />
                <span className="text-slate-400 text-xs">to</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={filters.areaMax}
                  onChange={(e) => changeFilters({ areaMax: digitsOnly(e.target.value) })}
                  placeholder="Max"
                  aria-label="Largest court size in sq ft"
                  className="input w-20 text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="wl-stage" className={labelCls}>Stage</label>
              <select
                id="wl-stage"
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
            <div>
              <label htmlFor="wl-rep" className={labelCls}>Rep</label>
              <select
                id="wl-rep"
                value={filters.assigned}
                onChange={(e) => changeFilters({ assigned: e.target.value })}
                className="input w-44 text-sm"
              >
                <option value="">All reps</option>
                <option value="unassigned">Unassigned</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {options.labels.length > 0 && (
              <DropdownFilter label="Label" value={filters.label} onChange={(v) => changeFilters({ label: v })} options={options.labels} />
            )}
            <DropdownFilter label="Came from" value={filters.cameFrom} onChange={(v) => changeFilters({ cameFrom: v })} options={options.cameFrom} />
          </div>
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
              {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        </div>

        {/* Ticked leads -> bulk actions */}
        {pickedIds.size > 0 && (
          <div className="sticky top-0 z-20 bg-court-700 text-white rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 shadow-lg">
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
                    className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
                  >
                    👤 Assign to rep
                  </button>
                ))}
              <button
                type="button"
                onClick={() => setGroupDialogOpen(true)}
                className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
              >
                👥 Add to group
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div ref={tableTopRef} className={loading ? "opacity-60 transition-opacity" : ""} aria-busy={loading}>
          {loadError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <span>Couldn&apos;t load these leads.</span>
              <button type="button" onClick={() => refetch(false)} className="btn btn-secondary !px-2.5 !py-1 !text-xs">
                Try again
              </button>
            </div>
          ) : loading && leads.length === 0 ? (
            <p className="text-sm text-slate-400">Loading leads…</p>
          ) : total === 0 ? (
            <p className="text-sm text-slate-400">
              {hasFilter ? "No leads match the current filters." : "No website leads yet"}
            </p>
          ) : (
            <>
              {/* Mobile: select all */}
              <label className="md:hidden flex items-center gap-2 px-1 pb-2 text-xs font-medium text-slate-600">
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
                    onClick={() => openLead(l.id)}
                    className={`p-4 cursor-pointer transition-colors ${pickedIds.has(l.id) ? "bg-court-50" : "hover:bg-slate-50"}`}
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
                        aria-label={`Select ${l.name}`}
                        className={`${checkboxCls} mt-0.5 shrink-0`}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/website-leads/${l.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block font-medium text-slate-900 truncate hover:text-court-700"
                        >
                          {l.name}
                        </Link>
                        <div className="text-xs text-slate-500 truncate mt-0.5 font-mono">{l.phone}</div>
                      </div>
                      <span className={`shrink-0 badge ${stageChipFromRow(l.stage, stageCatalog)}`}>
                        {stageLabelFromRow(l.stage, stageCatalog)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                      <div className="truncate">{fmtShortDateTimeIST(l.receivedAt)}</div>
                      <div className="truncate">{l.assignedToName ?? "Unassigned"}</div>
                      <div className="truncate">{l.city ?? "—"}</div>
                      <div className="truncate">{l.sport ?? "—"}</div>
                      <div className="truncate">{courtSizeText(l) ?? "—"}</div>
                      {l.startWhen && <div className="truncate">Starts: {l.startWhen}</div>}
                      {l.surface && <div className="truncate col-span-2">Page: {l.surface}</div>}
                      <div className="truncate col-span-2">Came from: {l.cameFrom ?? "Unknown"}</div>
                    </div>
                    {(l.labels.length > 0 || l.badges.length > 0) && (
                      <div className="mt-2 space-y-1.5">
                        {l.labels.length > 0 && <LabelChips labels={l.labels} />}
                        {l.badges.length > 0 && <LeadBadges badges={l.badges} />}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                {/* Tighter cell padding so the table fits a 1280px laptop with the sidebar open. */}
                <table className="data-table [&_td]:px-2 [&_th]:px-2">
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
                          className={checkboxCls}
                        />
                      </th>
                      {["Lead", "Came from", "Place", "Court", "Received (IST)", "Stage", "Rep", "Labels / badges"].map((h) => (
                        // Below 1366px "Came from" moves under the lead's name (see the Lead cell).
                        <th key={h} className={`whitespace-nowrap ${h === "Came from" ? "hidden min-[1366px]:table-cell" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l, i) => {
                      const area = courtAreaText(l);
                      return (
                        <tr
                          key={l.id}
                          onClick={() => openLead(l.id)}
                          className={`cursor-pointer transition-colors ${pickedIds.has(l.id) ? "bg-court-50" : "hover:bg-slate-50"}`}
                        >
                          <td className="w-8 !pr-0" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={pickedIds.has(l.id)}
                              onClick={(e) => {
                                shiftHeldRef.current = e.shiftKey;
                              }}
                              onChange={() => togglePicked(i)}
                              aria-label={`Select ${l.name}`}
                              className={checkboxCls}
                            />
                          </td>
                          <td className="max-w-[14rem] break-words font-medium">
                            <Link
                              href={`/website-leads/${l.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-court-700 hover:underline"
                            >
                              {l.name}
                            </Link>
                            <div className="text-xs text-slate-500 font-mono font-normal whitespace-nowrap">{l.phone}</div>
                            <div className="mt-1 font-normal min-[1366px]:hidden">
                              <CameFromChip cameFrom={l.cameFrom} group={l.cameFromGroup} />
                            </div>
                          </td>
                          <td className="hidden whitespace-nowrap min-[1366px]:table-cell">
                            <CameFromChip cameFrom={l.cameFrom} group={l.cameFromGroup} />
                          </td>
                          <td className="whitespace-nowrap text-slate-700">
                            {l.city ?? "—"}
                            {l.sport && <div className="text-xs text-slate-500">{l.sport}</div>}
                          </td>
                          <td className="whitespace-nowrap text-slate-700">
                            {courtSizeText(l) ?? "—"}
                            {area && <div className="text-xs text-slate-400">{area}</div>}
                            {l.startWhen && <div className="max-w-[10rem] whitespace-normal text-xs text-slate-500">Start: {l.startWhen}</div>}
                          </td>
                          <td className="text-slate-500 text-xs font-mono">{fmtShortDateTimeIST(l.receivedAt)}</td>
                          <td className="whitespace-nowrap">
                            <span className={`badge ${stageChipFromRow(l.stage, stageCatalog)}`}>
                              {stageLabelFromRow(l.stage, stageCatalog)}
                            </span>
                          </td>
                          <td className="text-slate-700">
                            {l.assignedToName ? (
                              <div className="max-w-[8rem] truncate" title={l.assignedToName}>{l.assignedToName}</div>
                            ) : (
                              <span className="text-slate-400 whitespace-nowrap">Unassigned</span>
                            )}
                          </td>
                          <td className="max-w-[14rem]">
                            {l.labels.length === 0 && l.badges.length === 0 ? (
                              <span className="text-slate-300 text-xs">—</span>
                            ) : (
                              <div className="space-y-1">
                                {l.labels.length > 0 && <LabelChips labels={l.labels} />}
                                {l.badges.length > 0 && <LeadBadges badges={l.badges} />}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
                    Page <span className="font-mono">{page}</span> of <span className="font-mono">{pageCount}</span>
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

      {groupDialogOpen && (
        <AddToGroupDialog
          websiteLeadIds={[...pickedIds]}
          onClose={() => setGroupDialogOpen(false)}
          onDone={() => setGroupDialogOpen(false)}
        />
      )}
    </>
  );
}
