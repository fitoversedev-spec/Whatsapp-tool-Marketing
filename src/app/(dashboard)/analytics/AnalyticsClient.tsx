"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
// Deep imports bypass Next.js's automatic barrel optimization, which fails
// with errno -4094 ("UNKNOWN: unknown error, read") when the project lives
// inside a OneDrive-synced folder (OneDrive briefly locks files during sync,
// racing with webpack's reads of the virtual barrel module).
import { Area } from "recharts/es6/cartesian/Area";
import { AreaChart } from "recharts/es6/chart/AreaChart";
import { CartesianGrid } from "recharts/es6/cartesian/CartesianGrid";
import { Cell } from "recharts/es6/component/Cell";
import { Legend } from "recharts/es6/component/Legend";
import { Pie } from "recharts/es6/polar/Pie";
import { PieChart } from "recharts/es6/chart/PieChart";
import { ResponsiveContainer } from "recharts/es6/component/ResponsiveContainer";
import { Tooltip } from "recharts/es6/component/Tooltip";
import { XAxis } from "recharts/es6/cartesian/XAxis";
import { YAxis } from "recharts/es6/cartesian/YAxis";
import PageHeader from "@/components/PageHeader";

type KPIs = {
  totalBroadcasts: number;
  totalSent: number;
  totalDelivered: number;
  totalRead: number;
  totalFailed: number;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  costEstimate: number;
};

type TimelinePoint = {
  date: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
};

type TemplateRow = {
  templateName: string;
  category: string;
  broadcasts: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
};

type FailureRow = {
  code: string;
  sample: string;
  count: number;
};

type BroadcastRow = {
  id: string;
  name: string;
  templateName: string;
  category: string;
  status: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  createdByName: string;
  createdAt: string;
  cost: number;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  scheduled: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const FAILURE_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#a855f7",
  "#0ea5e9",
  "#64748b",
];

export default function AnalyticsClient({
  range,
  kpis,
  timeline,
  templates,
  failures,
  broadcasts,
}: {
  range: "7d" | "30d" | "90d" | "all";
  kpis: KPIs;
  timeline: TimelinePoint[];
  templates: TemplateRow[];
  failures: FailureRow[];
  broadcasts: BroadcastRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setRange(r: string) {
    const next = new URLSearchParams(params.toString());
    next.set("range", r);
    router.push(`/analytics?${next.toString()}`);
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`${kpis.totalBroadcasts} broadcasts · ${formatNumber(kpis.totalSent)} messages sent · ${formatINR(kpis.costEstimate)} estimated cost`}
        action={<RangeSelector value={range} onChange={setRange} />}
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <KpiCard
            label="Total sent"
            value={formatNumber(kpis.totalSent)}
            sub={`${kpis.totalBroadcasts} broadcasts`}
            tone="default"
          />
          <KpiCard
            label="Delivery rate"
            value={formatPct(kpis.deliveryRate)}
            sub={`${formatNumber(kpis.totalDelivered)} delivered`}
            tone={kpis.deliveryRate >= 0.9 ? "good" : kpis.deliveryRate >= 0.7 ? "warn" : "bad"}
          />
          <KpiCard
            label="Read rate"
            value={formatPct(kpis.readRate)}
            sub={`${formatNumber(kpis.totalRead)} read · of delivered`}
            tone={kpis.readRate >= 0.5 ? "good" : kpis.readRate >= 0.25 ? "warn" : "bad"}
          />
          <KpiCard
            label="Est. cost"
            value={formatINR(kpis.costEstimate)}
            sub={`${formatNumber(kpis.totalFailed)} failures · ${formatPct(kpis.failureRate)}`}
            tone="default"
          />
        </div>

        {/* Timeline chart */}
        <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Delivery over time</h2>
              <p className="text-xs text-slate-500">Daily counts in IST · click points for detail</p>
            </div>
          </div>
          {timeline.length === 0 ? (
            <EmptyState message="No messages sent in this range yet." />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    stroke="#64748b"
                    fontSize={11}
                    tickFormatter={shortDate}
                  />
                  <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                    }}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name="Sent"
                    stackId="0"
                    stroke="#64748b"
                    fill="#cbd5e1"
                    fillOpacity={0.4}
                  />
                  <Area
                    type="monotone"
                    dataKey="delivered"
                    name="Delivered"
                    stackId="1"
                    stroke="#10b981"
                    fill="#34d399"
                    fillOpacity={0.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="read"
                    name="Read"
                    stackId="2"
                    stroke="#8b5cf6"
                    fill="#a78bfa"
                    fillOpacity={0.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    name="Failed"
                    stackId="3"
                    stroke="#ef4444"
                    fill="#fca5a5"
                    fillOpacity={0.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Two-column: templates + failures */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Template performance</h2>
              <p className="text-xs text-slate-500 mt-0.5">Sorted by most messages sent</p>
            </div>
            {templates.length === 0 ? (
              <EmptyState message="No template stats for this range." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Template</th>
                      <th className="text-right px-3 py-2.5 font-medium">Used</th>
                      <th className="text-right px-3 py-2.5 font-medium">Sent</th>
                      <th className="text-right px-3 py-2.5 font-medium">Deliv %</th>
                      <th className="text-right px-3 py-2.5 font-medium">Read %</th>
                      <th className="text-right px-4 py-2.5 font-medium">Fail %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {templates.map((t) => {
                      const dRate = t.sent > 0 ? t.delivered / t.sent : 0;
                      const rRate = t.delivered > 0 ? t.read / t.delivered : 0;
                      const fRate = t.sent > 0 ? t.failed / t.sent : 0;
                      return (
                        <tr key={t.templateName} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{t.templateName}</div>
                            <div className="text-xs text-slate-500">{t.category}</div>
                          </td>
                          <td className="text-right px-3 py-3 text-slate-700">{t.broadcasts}</td>
                          <td className="text-right px-3 py-3 text-slate-700">{formatNumber(t.sent)}</td>
                          <td className="text-right px-3 py-3">
                            <span className={rateColor(dRate, "deliv")}>{formatPct(dRate)}</span>
                          </td>
                          <td className="text-right px-3 py-3">
                            <span className={rateColor(rRate, "read")}>{formatPct(rRate)}</span>
                          </td>
                          <td className="text-right px-4 py-3">
                            <span className={fRate > 0 ? "text-red-600" : "text-slate-400"}>
                              {formatPct(fRate)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Failure breakdown</h2>
              <p className="text-xs text-slate-500 mt-0.5">By Meta error code</p>
            </div>
            {failures.length === 0 ? (
              <div className="p-5">
                <EmptyState message="No failures in this range 🎉" />
              </div>
            ) : (
              <>
                <div className="h-48 w-full p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={failures.slice(0, 6)}
                        dataKey="count"
                        nameKey="code"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={36}
                      >
                        {failures.slice(0, 6).map((_, i) => (
                          <Cell key={i} fill={FAILURE_PALETTE[i % FAILURE_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="divide-y divide-slate-100 text-sm">
                  {failures.slice(0, 8).map((f, i) => (
                    <li key={f.code} className="px-4 py-2.5 flex items-start gap-3">
                      <span
                        className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                        style={{
                          background: FAILURE_PALETTE[i % FAILURE_PALETTE.length],
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-slate-900">[{f.code}]</span>
                          <span className="text-xs text-slate-500">{f.count}×</span>
                        </div>
                        {f.sample && (
                          <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                            {f.sample}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* Per-broadcast table */}
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Broadcasts in range</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Click a broadcast for full recipient detail
            </p>
          </div>
          {broadcasts.length === 0 ? (
            <EmptyState message="No broadcasts in this range." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Name</th>
                    <th className="text-left px-3 py-2.5 font-medium">Template</th>
                    <th className="text-left px-3 py-2.5 font-medium">Status</th>
                    <th className="text-right px-3 py-2.5 font-medium">Sent</th>
                    <th className="text-right px-3 py-2.5 font-medium">Deliv</th>
                    <th className="text-right px-3 py-2.5 font-medium">Read</th>
                    <th className="text-right px-3 py-2.5 font-medium">Fail</th>
                    <th className="text-right px-3 py-2.5 font-medium">Cost</th>
                    <th className="text-left px-4 py-2.5 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {broadcasts.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/broadcasts/${b.id}`}
                          className="font-medium text-slate-900 hover:text-wa-dark"
                        >
                          {b.name}
                        </Link>
                        <div className="text-xs text-slate-500">by {b.createdByName}</div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{b.templateName}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                            STATUS_COLORS[b.status] ?? "bg-slate-100"
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="text-right px-3 py-3 text-slate-700">{b.sent}</td>
                      <td className="text-right px-3 py-3 text-emerald-700">{b.delivered}</td>
                      <td className="text-right px-3 py-3 text-purple-700">{b.read}</td>
                      <td className="text-right px-3 py-3">
                        <span className={b.failed > 0 ? "text-red-600" : "text-slate-400"}>
                          {b.failed}
                        </span>
                      </td>
                      <td className="text-right px-3 py-3 text-slate-700">{formatINR(b.cost)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(b.createdAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-slate-400 text-center">
          Cost is an estimate based on Meta India INR rates (Marketing ₹0.78, Utility ₹0.115 per
          conversation). Real billing may differ.
        </p>
      </div>
    </>
  );
}

function RangeSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (r: string) => void;
}) {
  const options: { id: string; label: string }[] = [
    { id: "7d", label: "7 days" },
    { id: "30d", label: "30 days" },
    { id: "90d", label: "90 days" },
    { id: "all", label: "All time" },
  ];
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
            value === o.id
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "default" | "good" | "warn" | "bad";
}) {
  const valueColor =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-red-700"
          : "text-slate-900";
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl sm:text-3xl font-bold ${valueColor} mt-2`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-10 text-center text-sm text-slate-500">{message}</div>
  );
}

function rateColor(rate: number, kind: "deliv" | "read") {
  if (kind === "deliv") {
    if (rate >= 0.9) return "text-emerald-700 font-medium";
    if (rate >= 0.7) return "text-amber-700";
    return "text-red-700";
  }
  if (rate >= 0.5) return "text-emerald-700 font-medium";
  if (rate >= 0.25) return "text-amber-700";
  return "text-slate-700";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-IN");
}

function formatPct(rate: number): string {
  if (rate === 0) return "0%";
  return `${(rate * 100).toFixed(rate >= 0.1 ? 0 : 1)}%`;
}

function formatINR(amount: number): string {
  if (amount === 0) return "₹0";
  if (amount < 1) return `₹${amount.toFixed(2)}`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function shortDate(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
