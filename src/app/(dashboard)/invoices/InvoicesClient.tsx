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

export default function InvoicesClient() {
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
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
        />
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full ${status === s ? "bg-wa-green text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {s ? STATUS_LABEL[s] : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <th className="text-left font-medium px-3 py-2.5">Invoice</th>
              <th className="text-left font-medium px-3 py-2.5">Customer</th>
              <th className="text-right font-medium px-3 py-2.5">Total</th>
              <th className="text-right font-medium px-3 py-2.5">Paid</th>
              <th className="text-left font-medium px-3 py-2.5">Status</th>
              <th className="text-left font-medium px-3 py-2.5">Due</th>
              <th className="text-left font-medium px-3 py-2.5">Rep</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">No invoices yet. Convert a confirmed quote from the Quotations page.</td></tr>
            ) : (
              rows.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/invoices/${inv.id}`} className="font-medium text-wa-dark hover:underline">{inv.number}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{inv.customerName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{inr(inv.grandTotal)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{inr(inv.amountPaid)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[inv.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{dateShort(inv.dueDate)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{inv.createdByName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
