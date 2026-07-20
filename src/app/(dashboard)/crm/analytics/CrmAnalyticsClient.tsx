"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { downloadCsv, downloadXlsx } from "@/lib/analytics/export";
import DateRangePicker, { defaultDateRange, type DateRange } from "@/components/DateRangePicker";

type SalesActivityRow = {
  ownerId: string; ownerName: string; leadsCreated: number; dealsCreated: number; siteVisits: number;
  quotationsSentInclRevisions: number; quotedValue: number; dealsWon: number; dealsClosed: number;
  wonValue: number; winRate: number | null; avgCycleDays: number | null;
};
type FunnelStageRow = { stageId: string; stageName: string; stageType: string; count: number; value: number };
type SourceRow = { sourceName: string; leads: number; qualified: number; quoted: number; won: number; wonValue: number; leadToWonRate: number | null };
type ProductConversionRow = { productName: string; enquiries: number; quoted: number; won: number; conversionRate: number | null; flagged: boolean };
type ProductCityCell = { productName: string; city: string; wonValue: number; enquiries: number };
export type StageVelocityRow = { stageId: string; stageName: string; sortOrder: number; medianDays: number | null; p90Days: number | null; n: number };

type AnalyticsResponse = {
  isAdmin: boolean;
  salesActivity: SalesActivityRow[];
  funnel: { stages: FunnelStageRow[]; lossReasons: { reasonName: string; count: number }[] };
  products: { conversion: ProductConversionRow[]; cityHeatmap: ProductCityCell[] };
  sources: { sources: SourceRow[] };
  stageVelocity: StageVelocityRow[];
};

function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtPct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

const TABS = ["individual", "overall", "products", "platforms"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  individual: "Individual performance",
  overall: "Overall performance",
  products: "Best-selling products",
  platforms: "Platform performance",
};

export default function CrmAnalyticsClient({ isAdmin }: { isAdmin: boolean }) {
  const [range, setRange] = useState<DateRange>(() => defaultDateRange(30));
  const [tab, setTab] = useState<Tab>(isAdmin ? "overall" : "individual");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/analytics?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="CRM Analytics"
        description="Individual and team performance, best sellers, and platform performance — across every channel, not just WhatsApp"
        action={<DateRangePicker value={range} onApply={setRange} />}
      />

      <div className="flex gap-1 border-b border-slate-200 mb-4 mt-4 overflow-x-auto">
        {TABS.filter((t) => isAdmin || t !== "overall").map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t ? "border-wa-green text-wa-dark" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading...</div>
      ) : (
        <>
          {tab === "individual" && <IndividualTab rows={data.salesActivity} range={range} />}
          {tab === "overall" && <OverallTab funnel={data.funnel} salesActivity={data.salesActivity} stageVelocity={data.stageVelocity} />}
          {tab === "products" && <ProductsTab rows={data.products.conversion} cityHeatmap={data.products.cityHeatmap} />}
          {tab === "platforms" && <PlatformsTab rows={data.sources.sources} />}
        </>
      )}
    </div>
  );
}

function ExportButtons({ filename, headers, rows }: { filename: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="flex gap-3 text-xs">
      <button onClick={() => downloadCsv(filename, headers, rows)} className="text-wa-dark hover:underline font-medium">Export CSV</button>
      <button onClick={() => downloadXlsx(filename, headers, rows)} className="text-wa-dark hover:underline font-medium">Export XLSX</button>
    </div>
  );
}

function IndividualTab({ rows, range }: { rows: SalesActivityRow[]; range: DateRange }) {
  const headers = ["Rep", "Leads", "Deals created", "Site visits", "Quotations sent", "Quoted value", "Deals won", "Won value", "Win rate", "Avg cycle days"];
  const dataRows = rows.map((r) => [r.ownerName, r.leadsCreated, r.dealsCreated, r.siteVisits, r.quotationsSentInclRevisions, r.quotedValue, r.dealsWon, r.wonValue, fmtPct(r.winRate), r.avgCycleDays ?? "—"]);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Per-rep activity</h3>
        <ExportButtons filename="individual-performance" headers={headers} rows={dataRows} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500 border-b border-slate-200">{headers.map((h) => <th key={h} className="px-2 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ownerId} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-2 font-medium">
                  <Link href={`/crm/analytics/rep/${r.ownerId}?from=${range.from}&to=${range.to}`} className="text-wa-dark hover:underline">
                    {r.ownerName}
                  </Link>
                </td>
                <td className="px-2 py-2">{r.leadsCreated}</td>
                <td className="px-2 py-2">{r.dealsCreated}</td>
                <td className="px-2 py-2">{r.siteVisits}</td>
                <td className="px-2 py-2">{r.quotationsSentInclRevisions}</td>
                <td className="px-2 py-2">{fmtInr(r.quotedValue)}</td>
                <td className="px-2 py-2">{r.dealsWon}</td>
                <td className="px-2 py-2">{fmtInr(r.wonValue)}</td>
                <td className="px-2 py-2">{fmtPct(r.winRate)}</td>
                <td className="px-2 py-2">{r.avgCycleDays ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="px-2 py-6 text-center text-slate-400">No activity in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function fmtDays(n: number | null): string {
  return n == null ? "—" : n < 1 ? `${Math.round(n * 24)}h` : `${n.toFixed(1)}d`;
}

export function StageVelocityCard({ rows }: { rows: StageVelocityRow[] }) {
  const withData = rows.filter((r) => r.n > 0);
  const maxDays = Math.max(1, ...withData.map((r) => r.medianDays ?? 0));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Time to move between stages</h3>
      <p className="text-xs text-slate-400 mb-3">Median days spent in each stage before advancing to the next one</p>
      {withData.length === 0 ? (
        <p className="text-sm text-slate-400">No stage transitions in this range yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.stageId} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-xs text-slate-600 truncate">{r.stageName}</div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                {r.medianDays != null && <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(r.medianDays / maxDays) * 100}%` }} />}
              </div>
              <div className="w-32 shrink-0 text-xs text-slate-500 text-right">
                {r.medianDays == null ? "insufficient data" : `${fmtDays(r.medianDays)} median · ${r.n} moves`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverallTab({ funnel, salesActivity, stageVelocity }: { funnel: AnalyticsResponse["funnel"]; salesActivity: SalesActivityRow[]; stageVelocity: StageVelocityRow[] }) {
  const teamTotals = salesActivity.reduce(
    (acc, r) => ({ dealsCreated: acc.dealsCreated + r.dealsCreated, dealsWon: acc.dealsWon + r.dealsWon, wonValue: acc.wonValue + r.wonValue, quotedValue: acc.quotedValue + r.quotedValue }),
    { dealsCreated: 0, dealsWon: 0, wonValue: 0, quotedValue: 0 },
  );
  const maxCount = Math.max(1, ...funnel.stages.map((s) => s.count));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Deals created</div><div className="text-xl font-semibold mt-1">{teamTotals.dealsCreated}</div></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Quoted value</div><div className="text-xl font-semibold mt-1">{fmtInr(teamTotals.quotedValue)}</div></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Deals won</div><div className="text-xl font-semibold mt-1">{teamTotals.dealsWon}</div></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Won value</div><div className="text-xl font-semibold mt-1">{fmtInr(teamTotals.wonValue)}</div></div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Pipeline by stage (current snapshot)</h3>
        <div className="space-y-2">
          {funnel.stages.map((s) => (
            <div key={s.stageId} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-xs text-slate-600 truncate">{s.stageName}</div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-wa-green rounded-full" style={{ width: `${(s.count / maxCount) * 100}%` }} /></div>
              <div className="w-28 shrink-0 text-xs text-slate-500 text-right">{s.count} · {fmtInr(s.value)}</div>
            </div>
          ))}
        </div>
      </div>
      {funnel.lossReasons.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Loss reasons</h3>
          <div className="space-y-1.5">
            {funnel.lossReasons.map((l) => (
              <div key={l.reasonName} className="flex items-center justify-between text-sm"><span className="text-slate-700">{l.reasonName}</span><span className="text-slate-500">{l.count}</span></div>
            ))}
          </div>
        </div>
      )}
      <StageVelocityCard rows={stageVelocity} />
    </div>
  );
}

function ProductsTab({ rows, cityHeatmap }: { rows: ProductConversionRow[]; cityHeatmap: ProductCityCell[] }) {
  const sorted = [...rows].sort((a, b) => b.won - a.won);
  const headers = ["Product", "Enquiries", "Quoted", "Won", "Conversion rate"];
  const dataRows = sorted.map((r) => [r.productName, r.enquiries, r.quoted, r.won, fmtPct(r.conversionRate)]);
  const maxWon = Math.max(1, ...sorted.map((r) => r.won));

  const cityRows = [...cityHeatmap].sort((a, b) => (a.city === b.city ? b.wonValue - a.wonValue : a.city.localeCompare(b.city)));
  const cityHeaders = ["City", "Product", "Enquiries", "Won value"];
  const cityDataRows = cityRows.map((r) => [r.city, r.productName, r.enquiries, r.wonValue]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-900">Best-selling flooring products, by deals won</h3>
          <ExportButtons filename="best-selling-products" headers={headers} rows={dataRows} />
        </div>
        <p className="text-xs text-slate-400 mb-3">Turf, acrylic, PVC and PPE-tile flooring only — fencing, lighting, nets and sub-base aren't a "product" line here</p>
        {sorted.length === 0 ? (
          <p className="text-sm text-slate-400">No product-level data in this range yet.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((r) => (
              <div key={r.productName} className="flex items-center gap-3">
                <div className="w-40 shrink-0 text-sm text-slate-700 truncate">{r.productName}</div>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${(r.won / maxWon) * 100}%` }} /></div>
                <div className="w-44 shrink-0 text-xs text-slate-500 text-right">
                  {r.won} won · {r.quoted} quoted · {fmtPct(r.conversionRate)}
                  {r.flagged && <span className="ml-1.5 text-amber-600 font-medium">low conv.</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Which flooring product sells best, by city</h3>
          <ExportButtons filename="flooring-by-city" headers={cityHeaders} rows={cityDataRows} />
        </div>
        {cityRows.length === 0 ? (
          <p className="text-sm text-slate-400">No city-level flooring data in this range yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  {cityHeaders.map((h) => <th key={h} className="px-2 py-2 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {cityRows.map((r) => (
                  <tr key={`${r.city}|${r.productName}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2 text-slate-700">{r.city}</td>
                    <td className="px-2 py-2 font-medium text-slate-900">{r.productName}</td>
                    <td className="px-2 py-2">{r.enquiries}</td>
                    <td className="px-2 py-2">{fmtInr(r.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PlatformsTab({ rows }: { rows: SourceRow[] }) {
  const sorted = [...rows].sort((a, b) => b.wonValue - a.wonValue);
  const headers = ["Source", "Leads", "Qualified", "Quoted", "Won", "Won value", "Lead-to-won rate"];
  const dataRows = sorted.map((r) => [r.sourceName, r.leads, r.qualified, r.quoted, r.won, r.wonValue, fmtPct(r.leadToWonRate)]);
  const maxLeads = Math.max(1, ...sorted.map((r) => r.leads));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Performance by platform / lead source</h3>
        <ExportButtons filename="platform-performance" headers={headers} rows={dataRows} />
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400">No source-level data in this range yet.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((r) => (
            <div key={r.sourceName} className="flex items-center gap-3">
              <div className="w-40 shrink-0 text-sm text-slate-700 truncate">{r.sourceName}</div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-wa-green rounded-full" style={{ width: `${(r.leads / maxLeads) * 100}%` }} /></div>
              <div className="w-56 shrink-0 text-xs text-slate-500 text-right">{r.leads} leads · {r.won} won · {fmtInr(r.wonValue)} · {fmtPct(r.leadToWonRate)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
