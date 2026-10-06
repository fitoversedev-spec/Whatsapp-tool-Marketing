"use client";

// Deals = confirmed projects only. A deal is created when a lead is marked
// Won (or from "+ New Deal" here), so there's no stage to move — the list
// shows the customer, the final value, when work starts and how the project
// is going. The customer's name opens their contact page; the deal code opens
// the deal page.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import WonDealModal from "@/components/crm/WonDealModal";

type Deal = {
  id: string;
  code: string;
  customerId: string | null;
  customerName: string;
  accountId: string;
  accountName: string;
  accountCity: string | null;
  ownerId: string | null;
  ownerName: string | null;
  value: number | null;
  wonAt: string | null;
  expectedStartAt: string | null;
  note: string | null;
  executionStatus: string | null;
};
type Option = { id: string; name: string };

function fmtInr(n: number | null): string {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const STATUS: Record<string, { label: string; cls: string }> = {
  NOT_STARTED: { label: "Not started", cls: "bg-slate-100 text-slate-700" },
  IN_EXECUTION: { label: "In execution", cls: "bg-amber-100 text-amber-800" },
  COMPLETED: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
};

function StatusBadge({ status }: { status: string | null }) {
  const s = STATUS[status ?? "NOT_STARTED"] ?? STATUS.NOT_STARTED;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// The customer's name → their contact page (falls back to the company page
// for an old deal with no contact on it).
function CustomerLink({ d, className }: { d: Deal; className: string }) {
  const href = d.customerId ? `/crm/contacts/${d.customerId}` : `/crm/companies/${d.accountId}`;
  return (
    <Link href={href} className={className} data-guide="crm-deals-customer-link">
      {d.customerName}
    </Link>
  );
}

export default function DealsClient({
  isAdmin,
  showOwnerFilter,
  deals,
  users,
  dateRange,
}: {
  isAdmin: boolean;
  showOwnerFilter: boolean;
  deals: Deal[];
  users: Option[];
  dateRange: DateRange | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [showNew, setShowNew] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  function applyDateRange(range: DateRange) {
    router.push(`/deals?from=${range.from}&to=${range.to}`);
  }

  const visible = deals.filter((d) => ownerFilter === "all" || d.ownerId === ownerFilter);
  const total = visible.reduce((sum, d) => sum + (d.value ?? 0), 0);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Shared by the per-row trash icon and the toolbar's bulk "Delete (N)" —
  // confirm → PATCH each → refresh. Admin-only (the API 403s otherwise).
  async function deleteDeals(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} deal(s)?`)) return;
    setDeleting(true);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/deals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleted: true }),
        }),
      ),
    );
    setDeleting(false);
    setSelected(new Set());
    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) toast.error(`${failed} of ${ids.length} deal(s) could not be deleted`);
    else toast.success(`${ids.length} deal${ids.length === 1 ? "" : "s"} deleted`);
    router.refresh();
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        large
        title="Deals"
        description={`${visible.length} confirmed project${visible.length === 1 ? "" : "s"} · ${fmtInr(total)}`}
        action={
          <button onClick={() => setShowNew(true)} className="btn btn-primary" data-guide="crm-deals-new">
            + New Deal
          </button>
        }
      />

      <div className="mb-3 flex items-center gap-2 flex-wrap" data-guide="crm-deals-filters">
        {showOwnerFilter && (
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="input w-auto text-sm">
            <option value="all">All reps</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        <DateRangePicker value={dateRange ?? { from: "", to: "" }} onApply={applyDateRange} />
        {dateRange && (
          <button onClick={() => router.push("/deals")} className="text-xs text-slate-500 hover:underline">
            Clear date filter
          </button>
        )}
        {isAdmin && selected.size > 0 && (
          <button
            type="button"
            onClick={() => deleteDeals(Array.from(selected))}
            disabled={deleting}
            className="btn btn-danger !px-3 !py-1.5 !text-xs"
          >
            {deleting ? "Deleting…" : `Delete (${selected.size})`}
          </button>
        )}
      </div>

      <div className="card">
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {visible.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-400">
              No confirmed projects yet — mark a lead Won, or use &quot;+ New Deal&quot;.
            </div>
          )}
          {visible.map((d) => (
            <div key={d.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CustomerLink d={d} className="block truncate font-medium text-court-700 hover:underline" />
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    <Link href={`/deals/${d.id}`} className="font-mono hover:underline">{d.code}</Link>
                    {d.accountName !== d.customerName && <span> · {d.accountName}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold font-mono text-slate-900">{fmtInr(d.value)}</div>
                  <StatusBadge status={d.executionStatus} />
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Won <span className="font-mono">{fmtDate(d.wonAt)}</span>
                {d.expectedStartAt && <> · starts <span className="font-mono">{fmtDate(d.expectedStartAt)}</span></>}
                {d.ownerName && <> · {d.ownerName}</>}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {isAdmin && (
                  <th className="w-8">
                    <SelectAllCheckbox ids={visible.map((d) => d.id)} selected={selected} onChange={setSelected} />
                  </th>
                )}
                <th className="text-left">Customer</th>
                <th className="text-left">Deal</th>
                <th className="text-left">Company</th>
                <th className="!text-right">Value</th>
                <th className="text-left">Expected start</th>
                <th className="text-left">Won on</th>
                <th className="text-left">Rep</th>
                <th className="text-left">Status</th>
                {isAdmin && <th className="w-8"><span className="sr-only">Delete</span></th>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 10 : 8} className="py-10 text-center text-slate-400">
                    No confirmed projects yet — mark a lead Won, or use &quot;+ New Deal&quot;.
                  </td>
                </tr>
              )}
              {visible.map((d) => (
                <tr key={d.id}>
                  {isAdmin && (
                    <td>
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelected(d.id)} aria-label={`Select ${d.code}`} />
                    </td>
                  )}
                  <td>
                    <CustomerLink d={d} className="font-medium text-court-700 hover:underline" />
                    {d.note && <div className="text-xs text-slate-500 truncate max-w-[220px]" title={d.note}>{d.note}</div>}
                  </td>
                  <td>
                    <Link href={`/deals/${d.id}`} className="font-mono text-sm text-slate-700 hover:underline" data-guide="crm-deals-row-link">
                      {d.code}
                    </Link>
                  </td>
                  <td className="text-slate-600">
                    {d.accountName}
                    {d.accountCity && <div className="text-xs text-slate-400">{d.accountCity}</div>}
                  </td>
                  <td className="!text-right font-mono font-semibold text-slate-900">{fmtInr(d.value)}</td>
                  <td className="text-slate-600 font-mono text-sm">{fmtDate(d.expectedStartAt)}</td>
                  <td className="text-slate-600 font-mono text-sm">{fmtDate(d.wonAt)}</td>
                  <td className="text-slate-600">{d.ownerName ?? "—"}</td>
                  <td><StatusBadge status={d.executionStatus} /></td>
                  {isAdmin && (
                    <td>
                      <button onClick={() => deleteDeals([d.id])} className="text-slate-400 hover:text-red-600" aria-label={`Delete ${d.code}`}>
                        <TrashIcon />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <WonDealModal
          contact={null}
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); router.refresh(); }}
        />
      )}
    </div>
  );
}
