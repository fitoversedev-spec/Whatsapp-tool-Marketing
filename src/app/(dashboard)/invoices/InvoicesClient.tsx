"use client";

// Invoices list — owner-scoped by the API (rep sees own, admin sees all).
// Invoices are created by converting a quotation, so there's no "new" button
// here; rows link to the invoice detail page.

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

type InvoiceRow = {
  id: string;
  number: string;
  customerName: string;
  sport: string;
  grandTotal: string;
  amountPaid: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  contactPhone: string | null;
  createdByName: string;
  createdAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  issued: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  partially_paid: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400 line-through",
};
const STATUS_LABEL: Record<string, string> = {
  issued: "Issued",
  sent: "Sent",
  partially_paid: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

function inr(s: string): string {
  return "₹" + Math.round(Number(s)).toLocaleString("en-IN");
}
function dateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUSES = ["", "issued", "sent", "partially_paid", "paid", "overdue", "cancelled"];

export default function InvoicesClient({ basePath = "" }: { basePath?: string } = {}) {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    const t = setTimeout(() => {
      fetch(`/api/invoices?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => setRows(d.invoices ?? []))
        .catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(t);
  }, [status, search]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader large title="Invoices" description="Confirmed quotes turned into invoices, with payment tracking." />

      <div className="flex flex-wrap items-center gap-2 mt-4 mb-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer / number / phone…"
          className="input w-64 text-sm"
        />
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full ${status === s ? "bg-court-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s ? STATUS_LABEL[s] : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {rows === null ? (
            <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 px-4 text-center text-sm text-slate-400">
              No invoices yet. Convert a confirmed quote from the Quotations page.
            </div>
          ) : (
            rows.map((inv) => (
              <Link
                key={inv.id}
                href={`${basePath}/invoices/${inv.id}`}
                className="block p-4 active:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{inv.customerName}</div>
                    <div className="text-xs text-slate-500 font-mono">{inv.number}</div>
                  </div>
                  <span className={`shrink-0 badge ${STATUS_STYLE[inv.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[inv.status] ?? inv.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <div>
                    Total
                    <span className="block font-mono text-slate-700">{inr(inv.grandTotal)}</span>
                  </div>
                  <div>
                    Paid
                    <span className="block font-mono text-slate-700">{inr(inv.amountPaid)}</span>
                  </div>
                  <div>
                    Due
                    <span className="block font-mono text-slate-700">{dateShort(inv.dueDate)}</span>
                  </div>
                  <div>
                    Rep
                    <span className="block text-slate-700">{inv.createdByName}</span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Invoice</th>
                <th className="text-left">Customer</th>
                <th className="!text-right">Total</th>
                <th className="!text-right">Paid</th>
                <th className="text-left">Status</th>
                <th className="text-left">Due</th>
                <th className="text-left">Rep</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-slate-400">No invoices yet. Convert a confirmed quote from the Quotations page.</td></tr>
              ) : (
                rows.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`${basePath}/invoices/${inv.id}`} className="font-medium text-court-700 hover:underline">{inv.number}</Link>
                    </td>
                    <td className="text-slate-700">{inv.customerName}</td>
                    <td className="!text-right font-mono">{inr(inv.grandTotal)}</td>
                    <td className="!text-right font-mono text-slate-500">{inr(inv.amountPaid)}</td>
                    <td>
                      <span className={`badge ${STATUS_STYLE[inv.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="text-slate-500 font-mono">{dateShort(inv.dueDate)}</td>
                    <td className="text-slate-500">{inv.createdByName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
