"use client";

// Invoice detail: header + line items + totals + payment history with a
// "Record payment" form, plus Send (rep's own number for CRM deals), Download,
// and Cancel actions.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type LineItem = { name: string; description?: string; areaSqFt: number; unit?: string | null; ratePerSqFt: number; gstPercent: number; total: number; included: boolean };
type Payment = { id: string; amount: string; paidAt: string; method: string | null; reference: string | null; note: string | null; recordedByName: string };
type Invoice = {
  id: string; number: string; customerName: string; contactPhone: string | null; sport: string;
  lineItems: LineItem[]; subtotal: string; gstAmount: string; grandTotal: string; amountPaid: string;
  status: string; invoiceDate: string; dueDate: string; sentAt: string | null; paidAt: string | null;
  notes: string | null; pdfUrl: string | null; payments: Payment[];
};

const STATUS_LABEL: Record<string, string> = { issued: "Issued", sent: "Sent", partially_paid: "Partly paid", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" };
const STATUS_STYLE: Record<string, string> = { issued: "bg-slate-100 text-slate-600", sent: "bg-blue-100 text-blue-700", partially_paid: "bg-amber-100 text-amber-700", paid: "bg-green-100 text-green-700", overdue: "bg-red-100 text-red-700", cancelled: "bg-slate-100 text-slate-400" };

const inr = (s: string | number) => "₹" + Math.round(Number(s)).toLocaleString("en-IN");
const dt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function InvoiceDetailClient({ id }: { id: string }) {
  const toast = useToast();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("upi");
  const [payRef, setPayRef] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/invoices/${id}`);
    if (!res.ok) { setInv(null); setLoading(false); return; }
    const d = await res.json();
    setInv(d.invoice);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Send failed"); return; }
      if (d.whatsappWebUrl) { window.open(d.whatsappWebUrl, "_blank"); toast.success("Opening WhatsApp — send from your number"); }
      else toast.success("Invoice sent");
      load();
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm("Cancel this invoice? It will be excluded from analytics.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
      if (res.ok) { toast.success("Invoice cancelled"); load(); } else toast.error("Could not cancel");
    } finally { setBusy(false); }
  }

  async function recordPayment() {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${id}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, method: payMethod, reference: payRef.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Could not record payment"); return; }
      setPayAmount(""); setPayRef("");
      toast.success("Payment recorded");
      load();
    } finally { setBusy(false); }
  }

  async function deletePayment(pid: string) {
    if (!confirm("Remove this payment?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${id}/payments/${pid}`, { method: "DELETE" });
      if (res.ok) { toast.success("Payment removed"); load(); } else toast.error("Could not remove");
    } finally { setBusy(false); }
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (!inv) return <div className="p-6 text-sm text-red-500">Invoice not found or you don't have access.</div>;

  const balance = Math.max(0, Number(inv.grandTotal) - Number(inv.amountPaid));
  const cancelled = inv.status === "cancelled";

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <Link href="/invoices" className="text-xs text-slate-400 hover:text-slate-700">← All invoices</Link>
      <PageHeader
        large
        title={inv.number}
        description={`${inv.customerName}${inv.contactPhone ? " · " + inv.contactPhone : ""}`}
        action={
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[inv.status] ?? "bg-slate-100"}`}>{STATUS_LABEL[inv.status] ?? inv.status}</span>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 mt-3">
        {!cancelled && (
          <button onClick={send} disabled={busy} className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50">
            {inv.sentAt ? "Resend" : "Send"} to customer
          </button>
        )}
        <a href={`/inv/${inv.id}`} target="_blank" rel="noreferrer" className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Download PDF</a>
        {!cancelled && <button onClick={cancel} disabled={busy} className="border border-red-200 text-red-600 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-red-50 disabled:opacity-50">Cancel</button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        <Info label="Invoice date" value={dt(inv.invoiceDate)} />
        <Info label="Due date" value={dt(inv.dueDate)} />
        <Info label="Grand total" value={inr(inv.grandTotal)} />
        <Info label="Balance due" value={inr(balance)} tone={balance > 0 ? "warn" : "good"} />
      </div>

      {/* Line items */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-xs">
              <th className="text-left font-medium px-3 py-2">Particulars</th>
              <th className="text-right font-medium px-3 py-2">Qty</th>
              <th className="text-right font-medium px-3 py-2">Rate</th>
              <th className="text-right font-medium px-3 py-2">GST%</th>
              <th className="text-right font-medium px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lineItems.filter((li) => li.included).map((li, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-700">{li.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Math.round(li.areaSqFt).toLocaleString("en-IN")}{li.unit ? ` ${li.unit}` : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(li.ratePerSqFt)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{li.gstPercent}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(li.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 text-slate-600"><td colSpan={4} className="px-3 py-1.5 text-right">Subtotal</td><td className="px-3 py-1.5 text-right tabular-nums">{inr(inv.subtotal)}</td></tr>
            <tr className="text-slate-600"><td colSpan={4} className="px-3 py-1.5 text-right">GST</td><td className="px-3 py-1.5 text-right tabular-nums">{inr(inv.gstAmount)}</td></tr>
            <tr className="border-t border-slate-200 font-semibold text-slate-900"><td colSpan={4} className="px-3 py-2 text-right">Grand total</td><td className="px-3 py-2 text-right tabular-nums">{inr(inv.grandTotal)}</td></tr>
          </tfoot>
        </table>
      </div>

      {/* Payments */}
      <div className="mt-6">
        <div className="text-sm font-semibold text-slate-800 mb-2">Payments — {inr(inv.amountPaid)} of {inr(inv.grandTotal)} collected</div>
        {!cancelled && balance > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 mb-3">
            <label className="text-xs text-slate-500">Amount
              <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={String(Math.round(balance))} className="block mt-1 w-32 border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">Method
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="block mt-1 border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="upi">UPI</option><option value="bank">Bank</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">Reference
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="txn / UTR (optional)" className="block mt-1 w-40 border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </label>
            <button onClick={recordPayment} disabled={busy} className="bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50">Record payment</button>
          </div>
        )}
        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
          {inv.payments.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-400 text-center">No payments recorded yet.</div>
          ) : (
            inv.payments.map((p) => (
              <div key={p.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className="font-medium tabular-nums text-slate-800 w-24">{inr(p.amount)}</span>
                <span className="text-slate-500">{dt(p.paidAt)}</span>
                {p.method && <span className="text-xs bg-slate-100 rounded px-1.5 py-0.5 text-slate-500 uppercase">{p.method}</span>}
                {p.reference && <span className="text-xs text-slate-400">{p.reference}</span>}
                <span className="text-xs text-slate-400 ml-auto">by {p.recordedByName}</span>
                {!cancelled && <button onClick={() => deletePayment(p.id)} className="text-xs text-slate-400 hover:text-red-600">remove</button>}
              </div>
            ))
          )}
        </div>
      </div>

      {inv.notes && <div className="mt-5 text-sm text-slate-600"><span className="font-medium">Notes:</span> {inv.notes}</div>}
    </div>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-wa-dark" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
