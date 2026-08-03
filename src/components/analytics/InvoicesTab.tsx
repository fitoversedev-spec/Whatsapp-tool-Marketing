"use client";

// Invoices analytics (admin-only) for CRM Analytics: KPI row (invoiced,
// collected, outstanding, overdue, collection rate, avg days-to-pay), a per-rep
// table, and a monthly invoiced-vs-collected trend. All figures exclude
// cancelled invoices.

import { fmtInr, fmtPct } from "./charts";

type Kpis = {
  invoicedValue: number;
  invoiceCount: number;
  collected: number;
  outstanding: number;
  overdue: number;
  collectionRate: number | null;
  avgDaysToPay: number | null;
};
type RepRow = {
  userId: string;
  userName: string;
  invoiceCount: number;
  invoicedValue: number;
  collected: number;
  outstanding: number;
  overdueAmount: number;
  collectionRate: number | null;
};
type Monthly = { month: string; invoiced: number; collected: number };
export type InvoiceAnalyticsData = { kpis: Kpis; reps: RepRow[]; monthly: Monthly[] };

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-wa-dark" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

export default function InvoicesTab({ data }: { data: InvoiceAnalyticsData }) {
  const k = data.kpis;
  const maxMonth = Math.max(1, ...data.monthly.map((m) => Math.max(m.invoiced, m.collected)));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Invoiced" value={fmtInr(k.invoicedValue)} />
        <Kpi label="Collected" value={fmtInr(k.collected)} tone="good" />
        <Kpi label="Outstanding" value={fmtInr(k.outstanding)} tone="warn" />
        <Kpi label="Overdue" value={fmtInr(k.overdue)} tone={k.overdue > 0 ? "bad" : undefined} />
        <Kpi label="Collection rate" value={fmtPct(k.collectionRate)} />
        <Kpi label="Avg days to pay" value={k.avgDaysToPay == null ? "—" : `${k.avgDaysToPay}d`} />
      </div>
      <div className="text-xs text-slate-400">{k.invoiceCount} invoice{k.invoiceCount === 1 ? "" : "s"} in range (cancelled excluded).</div>

      {/* Per-rep table */}
      <div>
        <div className="text-sm font-semibold text-slate-800 mb-2">By sales rep</div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left font-semibold px-3 py-2">Rep</th>
                <th className="text-right font-semibold px-3 py-2">Invoices</th>
                <th className="text-right font-semibold px-3 py-2">Invoiced</th>
                <th className="text-right font-semibold px-3 py-2">Collected</th>
                <th className="text-right font-semibold px-3 py-2">Outstanding</th>
                <th className="text-right font-semibold px-3 py-2">Overdue</th>
                <th className="text-right font-semibold px-3 py-2">Collection</th>
              </tr>
            </thead>
            <tbody>
              {data.reps.map((r) => (
                <tr key={r.userId} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{r.userName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.invoiceCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInr(r.invoicedValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-wa-dark">{fmtInr(r.collected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInr(r.outstanding)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.overdueAmount > 0 ? "text-red-600" : ""}`}>{fmtInr(r.overdueAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.collectionRate)}</td>
                </tr>
              ))}
              {data.reps.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400 text-sm">No invoices in this range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly invoiced vs collected */}
      {data.monthly.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-slate-800 mb-2">Invoiced vs cash received by month</div>
          <div className="text-[11px] text-slate-400 mb-2">Invoiced = value billed (by invoice date). Received = payments collected (by payment date).</div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            {data.monthly.map((m) => (
              <div key={m.month} className="flex items-center gap-3 text-xs">
                <div className="w-16 shrink-0 text-slate-500 tabular-nums">{m.month}</div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 rounded bg-slate-300" style={{ width: `${(m.invoiced / maxMonth) * 100}%`, minWidth: m.invoiced > 0 ? 4 : 0 }} />
                    <span className="text-slate-500 tabular-nums">{fmtInr(m.invoiced)} invoiced</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 rounded bg-wa-green" style={{ width: `${(m.collected / maxMonth) * 100}%`, minWidth: m.collected > 0 ? 4 : 0 }} />
                    <span className="text-wa-dark tabular-nums">{fmtInr(m.collected)} received</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
