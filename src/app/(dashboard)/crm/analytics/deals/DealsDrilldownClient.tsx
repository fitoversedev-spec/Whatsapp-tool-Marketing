"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { ExportButtons } from "@/components/analytics/ExportButtons";
import DateRangePicker, { defaultDateRange, type DateRange } from "@/components/DateRangePicker";
import type { RepDealRow } from "@/lib/analytics/repDeals";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Local Indian-format money helper — kept self-contained rather than importing
// charts.tsx's fmtInr, since that file is owned/edited elsewhere.
function fmtInr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

// Same key set as this page's own SearchParams — kept in sync deliberately,
// not re-derived, since both describe the same query-param contract. `reps` is
// intentionally excluded: it drives the comparison UI, not a filter chip.
const FILTER_LABELS: Record<string, string> = {
  productId: "Product",
  sportId: "Sport",
  city: "City",
  customerProfileId: "Segment",
  stageId: "Stage",
  outcome: "Outcome",
  from: "From",
  to: "To",
};

type UserOption = { id: string; name: string };

// Per-rep rollup for the admin side-by-side comparison. Computed client-side
// from the already-scoped `deals` — the server guarantees these rows only ever
// contain the (up to two) reps an admin explicitly picked.
type RepSummary = {
  ownerId: string;
  ownerName: string;
  dealCount: number;
  totalValue: number;
  stages: { stageName: string; count: number }[];
};

// One deals table — reused for the default single view and for each side of the
// two-rep comparison. `showOwner` adds the admin-only Owner/value column; it's
// off in comparison mode since each table already belongs to a single rep.
function DealsTable({ deals, showOwner }: { deals: RepDealRow[]; showOwner: boolean }) {
  const emptyColSpan = showOwner ? 5 : 4;
  return (
    <div className="bg-white rounded-xl border border-slate-300 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-600 border-b-2 border-slate-300">
            <th className="px-4 py-3 font-semibold">Customer</th>
            {showOwner && <th className="px-4 py-3 font-semibold">Owner</th>}
            <th className="px-4 py-3 font-semibold">Quote / design / product</th>
            <th className="px-4 py-3 font-semibold">Stage</th>
            <th className="px-4 py-3 font-semibold">Notes / upcoming</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.dealId} className="border-b border-slate-200 last:border-0 align-top hover:bg-slate-50">
              <td className="px-4 py-4">
                <Link href={`/deals/${d.dealId}`} className="text-base font-semibold text-wa-dark hover:underline">
                  {d.customerName}
                </Link>
                <div className="text-xs text-slate-500 mt-0.5">{d.dealCode}</div>
              </td>
              {showOwner && (
                <td className="px-4 py-4 text-sm">
                  <div className="font-medium text-slate-800">{d.ownerName}</div>
                  {d.dealValue > 0 && <div className="text-xs text-slate-500 mt-0.5">{fmtInr(d.dealValue)}</div>}
                </td>
              )}
              <td className="px-4 py-4 text-sm space-y-1.5">
                {d.quotations.length === 0 && d.courtImages.length === 0 && d.interestedProducts.length === 0 && (
                  <span className="text-slate-300">—</span>
                )}
                {/* No quote NUMBER in CRM areas (per spec) — customer is
                    already its own column, so the label is sport + status. */}
                {d.quotations.map((q) => (
                  <div key={q.id}>
                    <a href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer" className="text-wa-dark hover:underline font-medium">
                      📄 {q.sport} quote · {q.status}
                    </a>
                  </div>
                ))}
                {d.courtImages.map((c) => (
                  <div key={c.id}>
                    {c.imageUrl ? (
                      <a href={c.imageUrl} target="_blank" rel="noreferrer" className="text-wa-dark hover:underline font-medium">
                        🎨 Design {c.number}
                      </a>
                    ) : (
                      <span className="text-slate-500 font-medium">🎨 Design {c.number}</span>
                    )}
                    <span className="text-slate-400"> ({c.status})</span>
                  </div>
                ))}
                {d.interestedProducts.length > 0 && (
                  <div className="text-slate-600">📦 {d.interestedProducts.join(", ")}</div>
                )}
              </td>
              <td className="px-4 py-4">
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                  style={{ background: (d.stageColorHex ?? "#64748b") + "20", color: d.stageColorHex ?? "#475569" }}
                >
                  {d.stageName}
                </span>
              </td>
              <td className="px-4 py-4 text-sm text-slate-600 space-y-1.5 max-w-sm">
                {d.latestNote ? (
                  <div>
                    <span className="font-semibold text-slate-900">{d.latestNote.subject}</span>
                    {d.latestNote.notes && <div className="text-slate-600 mt-0.5">{d.latestNote.notes}</div>}
                    <div className="text-xs text-slate-400 mt-0.5">{fmtDate(d.latestNote.occurredAt)}</div>
                  </div>
                ) : (
                  <div className="text-slate-300">No notes yet</div>
                )}
                {d.nextActivity && (
                  <div className="text-amber-700 font-medium">
                    Next: {d.nextActivity.message} — {fmtDate(d.nextActivity.dueAt)}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {deals.length === 0 && (
            <tr>
              <td colSpan={emptyColSpan} className="px-4 py-8 text-center text-slate-400">
                No deals match this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DealsDrilldownClient({
  deals,
  filters,
  isAdmin,
  users,
  selectedReps,
}: {
  deals: RepDealRow[];
  filters: Record<string, string | undefined>;
  isAdmin: boolean;
  users: UserOption[];
  selectedReps: string[];
}) {
  const router = useRouter();

  // Back returns to the exact previous view (the tab/state the user drilled
  // from), not the analytics root — mirroring BackButton.tsx's browser-back
  // with a safe fallback only when there's no history to go back to.
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/crm/analytics");
  }

  // `reps` never shows as a filter chip (it's a comparison selector, not a
  // filter) — FILTER_LABELS has no entry, and we drop it explicitly here.
  const activeFilters = Object.entries(filters).filter(
    (entry): entry is [string, string] => !!entry[1] && entry[0] !== "reps",
  );

  const showComparison = isAdmin && selectedReps.length === 2;

  // Navigate to the same page with a new reps pair, preserving every other
  // active filter. An empty pick clears the param (back to company-wide).
  function applyReps(repA: string, repB: string) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && k !== "reps") params.set(k, v);
    }
    const chosen = [repA, repB].filter(Boolean);
    if (chosen.length) params.set("reps", chosen.join(","));
    const qs = params.toString();
    router.push(`/crm/analytics/deals${qs ? `?${qs}` : ""}`);
  }

  // Date filter seeds from the URL's from/to; absent either end we show a
  // sensible 90-day default in the picker without pushing until Apply.
  const dateRange: DateRange =
    filters.from && filters.to ? { from: filters.from, to: filters.to } : defaultDateRange(90);

  // Apply a new date range to the same page, preserving every other active
  // param (reps, city, stageId, outcome, productId, …) so filtering by date
  // never drops the comparison or the filter chips.
  function applyDateRange(range: DateRange) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && k !== "from" && k !== "to") params.set(k, v);
    }
    params.set("from", range.from);
    params.set("to", range.to);
    router.push(`/crm/analytics/deals?${params.toString()}`);
  }

  // Roll up the scoped deals per selected rep, in the order they were picked.
  const summaries: RepSummary[] = showComparison
    ? selectedReps.map((id) => {
        const own = deals.filter((d) => d.ownerId === id);
        const stageMap = new Map<string, number>();
        for (const d of own) stageMap.set(d.stageName, (stageMap.get(d.stageName) ?? 0) + 1);
        return {
          ownerId: id,
          ownerName: own[0]?.ownerName ?? users.find((u) => u.id === id)?.name ?? "Unknown rep",
          dealCount: own.length,
          totalValue: own.reduce((sum, d) => sum + d.dealValue, 0),
          stages: Array.from(stageMap.entries())
            .map(([stageName, count]) => ({ stageName, count }))
            .sort((a, b) => b.count - a.count),
        };
      })
    : [];

  const headers = isAdmin
    ? ["Customer", "Deal code", "Owner", "Value", "Quotations", "Court designs", "Products interested", "Stage", "Latest note", "Next activity"]
    : ["Customer", "Deal code", "Quotations", "Court designs", "Products interested", "Stage", "Latest note", "Next activity"];
  const dataRows = deals.map((d) => {
    const base = [
      d.customerName,
      d.dealCode,
      ...(isAdmin ? [d.ownerName, String(Math.round(d.dealValue))] : []),
      d.quotations.map((q) => `${q.sport} quote (${q.status})`).join(", "),
      d.courtImages.map((c) => c.number).join(", "),
      d.interestedProducts.join(", "),
      d.stageName,
      d.latestNote ? `${d.latestNote.subject}${d.latestNote.notes ? ` — ${d.latestNote.notes}` : ""} (${fmtDate(d.latestNote.occurredAt)})` : "",
      d.nextActivity ? `${d.nextActivity.message} (due ${fmtDate(d.nextActivity.dueAt)})` : "",
    ];
    return base;
  });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        large
        title="Deals"
        description={
          activeFilters.length === 0
            ? `${deals.length} deal${deals.length === 1 ? "" : "s"} matching the current view`
            : `${deals.length} deal${deals.length === 1 ? "" : "s"} — ${activeFilters.map(([k, v]) => `${FILTER_LABELS[k] ?? k}: ${v}`).join(" · ")}`
        }
        action={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <button
              type="button"
              onClick={goBack}
              className="text-sm text-wa-dark hover:underline font-medium whitespace-nowrap"
            >
              ← Back
            </button>
            <DateRangePicker value={dateRange} onApply={applyDateRange} />
            <ExportButtons filename="deals-drilldown" headers={headers} rows={dataRows} />
          </div>
        }
      />

      {isAdmin && (
        <div className="bg-white rounded-xl border border-slate-300 p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-700">Compare two reps</div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedReps[0] ?? ""}
              onChange={(e) => applyReps(e.target.value, selectedReps[1] ?? "")}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="">Rep A…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <span className="text-slate-400 text-sm">vs</span>
            <select
              value={selectedReps[1] ?? ""}
              onChange={(e) => applyReps(selectedReps[0] ?? "", e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="">Rep B…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {selectedReps.length > 0 && (
              <button
                type="button"
                onClick={() => applyReps("", "")}
                className="text-sm text-slate-500 hover:text-slate-900 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          {isAdmin && selectedReps.length === 1 && (
            <div className="text-xs text-slate-500">Pick a second rep to compare side by side.</div>
          )}
        </div>
      )}

      {showComparison ? (
        // Two-rep mode: each rep gets their own summary header + independent
        // deals table, side by side on desktop and stacked on mobile. Deals are
        // split by ownerId — the server already scoped `deals` to just these two.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {summaries.map((s) => (
            <div key={s.ownerId} className="space-y-3">
              <div className="bg-white rounded-xl border border-slate-300 p-4 space-y-3">
                <div className="text-base font-semibold text-wa-dark">{s.ownerName}</div>
                <div className="flex items-baseline gap-6">
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{s.dealCount}</div>
                    <div className="text-xs text-slate-500">deals created</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-900">{fmtInr(s.totalValue)}</div>
                    <div className="text-xs text-slate-500">total deal value</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">By stage</div>
                  {s.stages.length === 0 ? (
                    <div className="text-sm text-slate-300">No deals</div>
                  ) : (
                    <ul className="text-sm text-slate-700 space-y-0.5">
                      {s.stages.map((st) => (
                        <li key={st.stageName} className="flex justify-between">
                          <span>{st.stageName}</span>
                          <span className="font-semibold text-slate-900">{st.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <DealsTable deals={deals.filter((d) => d.ownerId === s.ownerId)} showOwner={false} />
            </div>
          ))}
        </div>
      ) : (
        <DealsTable deals={deals} showOwner={isAdmin} />
      )}
    </div>
  );
}
