"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";

// The wizard is heavy and only opens behind "+ New quotation", so code-split
// it out of the list page's initial bundle and load its chunk on first open.
const QuoteWizard = dynamic(() => import("./QuoteWizard"), { ssr: false });

type Quotation = {
  id: string;
  number: string;
  customerName: string;
  sport: string;
  lengthFt: number;
  widthFt: number;
  grandTotal: string;
  status: string;
  pdfUrl: string | null;
  quoteDate: string;
  validityDays: number;
  sentAt: string | null;
  contactPhone: string | null;
  createdByName: string;
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-purple-100 text-purple-800",
  accepted: "bg-emerald-100 text-emerald-800",
  expired: "bg-red-100 text-red-800",
};

export default function QuotationsClient({
  isAdmin,
  initialQuotations,
  salesUsers,
}: {
  isAdmin: boolean;
  initialQuotations: Quotation[];
  salesUsers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [quotations, setQuotations] = useState<Quotation[]>(initialQuotations);
  const [showWizard, setShowWizard] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // In-progress phone entry for drafts saved without one — the standalone
  // "New Quote" flow used to have no phone field at all, so any draft
  // created that way is permanently unsendable without this (see
  // docs/DECISIONS.md). Keyed by quotation id so multiple rows can be
  // edited independently.
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({});
  const [savingPhone, setSavingPhone] = useState<string | null>(null);

  async function savePhone(q: Quotation) {
    const phone = (phoneEdits[q.id] ?? "").trim();
    if (!phone) return;
    setSavingPhone(q.id);
    const res = await fetch(`/api/quotations/${q.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactPhone: phone }),
    });
    setSavingPhone(null);
    if (res.ok) {
      setQuotations((curr) => curr.map((x) => (x.id === q.id ? { ...x, contactPhone: phone } : x)));
      setPhoneEdits((curr) => {
        const next = { ...curr };
        delete next[q.id];
        return next;
      });
      toast.success("Phone number saved");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not save phone number");
    }
  }

  const filtered = useMemo(() => {
    return quotations.filter((q) => {
      if (statusFilter !== "all" && q.status !== statusFilter) return false;
      if (ownerFilter !== "all" && q.createdByName !== ownerFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (
          !q.customerName.toLowerCase().includes(s) &&
          !q.number.toLowerCase().includes(s) &&
          !(q.contactPhone ?? "").includes(s)
        )
          return false;
      }
      if (fromDate && new Date(q.createdAt) < new Date(fromDate)) return false;
      if (toDate && new Date(q.createdAt) > new Date(toDate + "T23:59:59")) return false;
      return true;
    });
  }, [quotations, search, statusFilter, ownerFilter, fromDate, toDate]);

  const totals = useMemo(() => {
    let sentCount = 0;
    let sentValue = 0;
    let acceptedValue = 0;
    for (const q of filtered) {
      if (q.status !== "draft") sentCount += 1;
      const v = Number(q.grandTotal);
      if (["sent", "viewed", "accepted"].includes(q.status)) sentValue += v;
      if (q.status === "accepted") acceptedValue += v;
    }
    return { sentCount, sentValue, acceptedValue };
  }, [filtered]);

  async function send(q: Quotation) {
    if (!q.contactPhone) {
      toast.error("No contact phone on this quotation");
      return;
    }
    const res = await fetch(`/api/quotations/${q.id}/send`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Send failed");
      return;
    }
    toast.success(`Quotation ${q.number} sent`);
    router.refresh();
  }

  async function markStatus(q: Quotation, status: string) {
    const res = await fetch(`/api/quotations/${q.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setQuotations((prev) => prev.map((x) => (x.id === q.id ? { ...x, status } : x)));
      toast.success(`Marked ${status}`);
    }
  }

  async function remove(q: Quotation) {
    if (!confirm(`Delete quotation ${q.number}? This cannot be undone.`)) return;
    const res = await fetch(`/api/quotations/${q.id}`, { method: "DELETE" });
    if (res.ok) {
      setQuotations((prev) => prev.filter((x) => x.id !== q.id));
      setSelected((prev) => {
        if (!prev.has(q.id)) return prev;
        const next = new Set(prev);
        next.delete(q.id);
        return next;
      });
      toast.success("Deleted");
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    const n = selected.size;
    if (!confirm(`Delete ${n} quotation${n === 1 ? "" : "s"}? This cannot be undone.`)) return;
    const ids = Array.from(selected);
    const res = await fetch("/api/quotations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Delete failed");
      return;
    }
    setQuotations((prev) => prev.filter((x) => !selected.has(x.id)));
    setSelected(new Set());
    const count = data.count ?? ids.length;
    toast.success(`Deleted ${count} quotation${count === 1 ? "" : "s"}`);
  }

  return (
    <>
      <PageHeader
        title="Quotations"
        description={`${filtered.length} of ${quotations.length} · ₹ ${totals.sentValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })} sent · ₹ ${totals.acceptedValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })} accepted`}
        action={
          <div className="flex gap-2">
            {isAdmin && (
              <Link
                href="/settings/quotation-rates"
                className="hidden sm:inline-flex self-center text-xs text-slate-600 hover:text-slate-900 px-2"
              >
                ⚙ Rate sheet
              </Link>
            )}
            <button
              onClick={() => setShowWizard(true)}
              className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
            >
              + New quotation
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row gap-2 flex-wrap">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number, customer, phone…"
            className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="viewed">Viewed</option>
            <option value="accepted">Accepted</option>
            <option value="expired">Expired</option>
          </select>
          {isAdmin && (
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="all">All sales people</option>
              {salesUsers.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            placeholder="From"
            className="px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            placeholder="To"
            className="px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>

        {isAdmin && selected.size > 0 && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
            <span className="text-red-800 font-medium">
              {selected.size} selected
            </span>
            <button onClick={bulkDelete} className="text-red-700 hover:underline font-medium">
              Delete selected
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-slate-500 hover:underline ml-auto"
            >
              Clear
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <div className="text-4xl mb-2">📄</div>
            <h3 className="font-semibold text-slate-900">
              {quotations.length === 0 ? "No quotations yet" : "No matches"}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {quotations.length === 0
                ? "Click + New quotation to create your first one."
                : "Adjust the filters above."}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    {isAdmin && (
                      <th className="px-4 py-3 text-left w-8">
                        <SelectAllCheckbox
                          ids={filtered.map((q) => q.id)}
                          selected={selected}
                          onChange={setSelected}
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left">Number</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Sport / Size</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    {isAdmin && <th className="px-4 py-3 text-left">By</th>}
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((q) => (
                    <tr
                      key={q.id}
                      className={`hover:bg-slate-50 ${selected.has(q.id) ? "bg-red-50/50" : ""}`}
                    >
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(q.id)}
                            onChange={() => toggleOne(q.id)}
                            className="rounded"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                        {q.number}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{q.customerName}</div>
                        {q.contactPhone ? (
                          <div className="text-xs text-slate-500 font-mono">+{q.contactPhone}</div>
                        ) : q.status === "draft" ? (
                          <div className="flex items-center gap-1 mt-1">
                            <input
                              value={phoneEdits[q.id] ?? ""}
                              onChange={(e) => setPhoneEdits((curr) => ({ ...curr, [q.id]: e.target.value }))}
                              placeholder="+919876543210"
                              className="w-32 px-1.5 py-0.5 text-xs border border-amber-300 rounded font-mono"
                            />
                            <button
                              onClick={() => savePhone(q)}
                              disabled={savingPhone === q.id || !(phoneEdits[q.id] ?? "").trim()}
                              className="text-xs text-blue-700 hover:underline disabled:opacity-40 disabled:no-underline"
                            >
                              {savingPhone === q.id ? "…" : "Save"}
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs text-amber-700">⚠ no phone</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 capitalize">
                        {q.sport}
                        <div className="text-xs text-slate-400">
                          {q.lengthFt} × {q.widthFt} ft
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        ₹ {Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                            STATUS_COLORS[q.status] ?? "bg-slate-100"
                          }`}
                        >
                          {q.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(q.quoteDate).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "2-digit",
                        })}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-xs text-slate-500">{q.createdByName}</td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-2 justify-end flex-wrap">
                          <a
                            href={`/api/quotations/${q.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-wa-dark hover:underline"
                          >
                            View PDF
                          </a>
                          {q.status === "draft" && q.contactPhone && (
                            <button
                              onClick={() => send(q)}
                              className="text-xs text-blue-700 hover:underline"
                            >
                              Send
                            </button>
                          )}
                          {q.status === "sent" && (
                            <button
                              onClick={() => markStatus(q, "accepted")}
                              className="text-xs text-emerald-700 hover:underline"
                            >
                              Mark accepted
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => remove(q)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showWizard && (
        <QuoteWizard
          open={showWizard}
          onClose={() => setShowWizard(false)}
          onComplete={() => {
            setShowWizard(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
