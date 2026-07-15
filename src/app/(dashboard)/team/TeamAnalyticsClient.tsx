"use client";

// Sales team analytics dashboard. Top: range picker + team-wide KPI
// cards. Middle: sortable per-salesperson table with click-to-expand
// drill-down (pipeline distribution + reminders + activity scoring).
// Right rail: recent activity feed (last 25 events across all sources).

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import type { Role } from "@/lib/rbac";

type Range = "7d" | "30d" | "90d" | "all";

type PerUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  assignedConversations: number;
  quotationsSent: number;
  quotationsDraft: number;
  quotationsValueInr: number;
  courtDesignsSent: number;
  courtDesignsDraft: number;
  messagesSent: number;
  notesWritten: number;
  remindersCompleted: number;
  remindersOverdue: number;
  pipelineMoves: number;
  pipelineDistribution: Record<string, number>;
};

type Activity = {
  id: string;
  type: "quote" | "design" | "note" | "pipeline";
  when: string;
  userId: string | null;
  userName: string | null;
  summary: string;
  href?: string;
};

// Phase 4 — the 9-screen analytics build. sales-activity + funnel ship
// first (see docs/DECISIONS.md); the remaining 7 land as further tabs.
type SalesActivityRow = {
  ownerId: string;
  ownerName: string;
  leadsCreated: number;
  dealsCreated: number;
  siteVisits: number;
  samplesSent: number;
  quotationsSentInclRevisions: number;
  uniqueDealsQuoted: number;
  quotedValue: number;
  dealsWon: number;
  dealsClosed: number;
  wonValue: number;
  winRate: number | null;
  avgCycleDays: number | null;
};

type FunnelStageRow = { stageId: string; stageName: string; stageType: string; sortOrder: number; count: number; value: number };
type LossReasonRow = { reasonName: string; count: number };
type FunnelPayload = { stages: FunnelStageRow[]; lossReasons: LossReasonRow[] };

type CityRow = {
  city: string;
  enquiries: number;
  quotations: number;
  won: number;
  wonValue: number;
  winRate: number | null;
  avgDealSize: number | null;
  avgCycleDays: number | null;
};
type TierRow = { tierName: string; enquiries: number; won: number; wonValue: number };
type GeographyPayload = { cities: CityRow[]; tiers: TierRow[] };

type SegmentRow = {
  profileName: string;
  enquiries: number;
  won: number;
  winRate: number | null;
  avgDealSize: number | null;
  avgCycleDays: number | null;
};
type BusinessTypeRow = { businessType: string; enquiries: number; won: number; wonValue: number };
type RepeatCustomer = { accountId: string; accountName: string; wonDeals: number; totalWonValue: number };
type CustomersPayload = { segments: SegmentRow[]; businessTypes: BusinessTypeRow[]; repeatCustomers: RepeatCustomer[] };

type ProductMovementRow = { month: string; productName: string; enquiries: number; quoted: number; quotedValue: number; won: number; wonValue: number };
type ProductConversionRow = { productName: string; enquiries: number; quoted: number; won: number; conversionRate: number | null; flagged: boolean };
type ProductsPayload = {
  movement: ProductMovementRow[];
  cityHeatmap: { productName: string; city: string; wonValue: number; enquiries: number }[];
  segmentMatrix: { productName: string; profileName: string; enquiries: number }[];
  conversion: ProductConversionRow[];
  distinctYears: number[];
};

type SourceRow = {
  sourceName: string;
  leads: number;
  qualified: number;
  quoted: number;
  won: number;
  wonValue: number;
  leadToWonRate: number | null;
  avgCycleDays: number | null;
  adSpend: number | null;
  costPerLead: number | null;
  cac: number | null;
  roas: number | null;
};
type SourcesPayload = {
  sources: SourceRow[];
  cityCrossTab: { sourceName: string; city: string; enquiries: number }[];
  productCrossTab: { sourceName: string; productName: string; enquiries: number }[];
};

type DurationStat = { medianDays: number | null; p90Days: number | null; n: number };
type StuckDeal = { dealId: string; dealCode: string; dealTitle: string; stageName: string; daysSinceChange: number; slaHours: number; usingDefaultSla: boolean };
type TimelinesPayload = {
  responseTime: DurationStat;
  enquiryToSiteVisit: DurationStat;
  siteVisitToQuotation: DurationStat;
  quotationToNegotiation: DurationStat;
  negotiationToClose: DurationStat;
  siteVisitToClose: DurationStat;
  fullCycle: DurationStat;
  timeInStage: DurationStat;
  stuckDeals: StuckDeal[];
};

type ForecastStageRow = { stageName: string; count: number; value: number; probabilityPercent: number | null };
type ForecastPayload = {
  weightedValue: number | null;
  unweightedValue: number;
  dealCount: number;
  probabilitiesConfigured: boolean;
  byStage: ForecastStageRow[];
};

type PeriodTotals = { quotationsSent: number; quotedValue: number; dealsWon: number; wonValue: number };
type MoverRow = { ownerName: string; wonValueDelta: number; thisPeriodWonValue: number; lastPeriodWonValue: number };
type OverviewPayload = { thisMonth: PeriodTotals; lastMonth: PeriodTotals; topMovers: MoverRow[]; stuckDealCount: number };

type AnalyticsPayload = {
  range: Range;
  since: string | null;
  teamTotals: {
    activeReps: number;
    assignedConversations: number;
    quotationsSent: number;
    quotationsValueInr: number;
    courtDesignsSent: number;
    messagesSent: number;
    remindersOverdue: number;
  };
  perUser: PerUser[];
  activity: Activity[];
  salesActivity: SalesActivityRow[];
  funnel: FunnelPayload;
  geography: GeographyPayload;
  customers: CustomersPayload;
  products: ProductsPayload;
  sources: SourcesPayload;
  timelines: TimelinesPayload;
  forecast: ForecastPayload;
  overview: OverviewPayload;
};

type Tab = "overview" | "activity" | "sales-activity" | "funnel" | "geography" | "customers" | "products" | "sources" | "timelines" | "forecast";

type SortKey =
  | "name"
  | "assigned"
  | "quotesSent"
  | "value"
  | "designsSent"
  | "messages"
  | "overdue";

export default function TeamAnalyticsClient() {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/team/analytics?range=${range}`)
      .then(async (r) => {
        const text = await r.text();
        let json: AnalyticsPayload | { error?: string; message?: string } | null = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        if (!r.ok) {
          const msg =
            (json && "message" in json && json.message) ||
            (json && "error" in json && json.error) ||
            `Failed (${r.status})`;
          throw new Error(msg);
        }
        if (json && "perUser" in json) setData(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const sortedUsers = useMemo(() => {
    if (!data) return [];
    const rows = [...data.perUser];
    rows.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortBy) {
        case "name":
          av = a.name;
          bv = b.name;
          break;
        case "assigned":
          av = a.assignedConversations;
          bv = b.assignedConversations;
          break;
        case "quotesSent":
          av = a.quotationsSent;
          bv = b.quotationsSent;
          break;
        case "value":
          av = a.quotationsValueInr;
          bv = b.quotationsValueInr;
          break;
        case "designsSent":
          av = a.courtDesignsSent;
          bv = b.courtDesignsSent;
          break;
        case "messages":
          av = a.messagesSent;
          bv = b.messagesSent;
          break;
        case "overdue":
          av = a.remindersOverdue;
          bv = b.remindersOverdue;
          break;
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc"
        ? Number(av) - Number(bv)
        : Number(bv) - Number(av);
    });
    return rows;
  }, [data, sortBy, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <>
      <PageHeader
        title="Sales Team Performance"
        description="Admin-only view of per-rep activity, pipeline health, and recent actions."
        action={
          <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
            {(["7d", "30d", "90d", "all"] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  range === r
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {r === "all" ? "All time" : `Last ${r}`}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-4 sm:px-6 lg:px-8 pt-4 flex gap-1.5">
        {(
          [
            ["overview", "Overview"],
            ["activity", "Team Activity"],
            ["sales-activity", "Sales Activity"],
            ["funnel", "Funnel"],
            ["geography", "Geography"],
            ["customers", "Customers"],
            ["products", "Products"],
            ["sources", "Sources"],
            ["timelines", "Timelines"],
            ["forecast", "Forecast"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === id ? "bg-wa-green text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {loading && (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
            Loading team analytics…
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && tab === "overview" && <OverviewTab data={data.overview} />}
        {data && tab === "sales-activity" && <SalesActivityTab rows={data.salesActivity} />}
        {data && tab === "funnel" && <FunnelTab data={data.funnel} />}
        {data && tab === "geography" && <GeographyTab data={data.geography} />}
        {data && tab === "customers" && <CustomersTab data={data.customers} />}
        {data && tab === "products" && <ProductsTab data={data.products} />}
        {data && tab === "sources" && <SourcesTab data={data.sources} />}
        {data && tab === "timelines" && <TimelinesTab data={data.timelines} />}
        {data && tab === "forecast" && <ForecastTab data={data.forecast} />}

        {data && tab === "activity" && (
          <>
            {/* Team KPI cards */}
            <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Kpi label="Active reps" value={data.teamTotals.activeReps} />
              <Kpi
                label="Assigned convos"
                value={data.teamTotals.assignedConversations}
                hint="open conversations with a rep assigned"
              />
              <Kpi
                label="Quotes sent"
                value={data.teamTotals.quotationsSent}
                hint={rangeHint(range)}
              />
              <Kpi
                label="Pipeline value"
                value={`₹${inr(data.teamTotals.quotationsValueInr)}`}
                hint="sum of sent quote totals"
              />
              <Kpi
                label="Designs sent"
                value={data.teamTotals.courtDesignsSent}
                hint={rangeHint(range)}
              />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
              {/* Per-user table */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Per salesperson
                  </h3>
                  <span className="text-xs text-slate-500">
                    {sortedUsers.length} {sortedUsers.length === 1 ? "rep" : "reps"}
                  </span>
                </div>
                {sortedUsers.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    No sales reps yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <Th onClick={() => toggleSort("name")} active={sortBy === "name"} dir={sortDir}>
                            Name
                          </Th>
                          <Th onClick={() => toggleSort("assigned")} active={sortBy === "assigned"} dir={sortDir} right>
                            Assigned
                          </Th>
                          <Th onClick={() => toggleSort("quotesSent")} active={sortBy === "quotesSent"} dir={sortDir} right>
                            Quotes
                          </Th>
                          <Th onClick={() => toggleSort("value")} active={sortBy === "value"} dir={sortDir} right>
                            Value
                          </Th>
                          <Th onClick={() => toggleSort("designsSent")} active={sortBy === "designsSent"} dir={sortDir} right>
                            Designs
                          </Th>
                          <Th onClick={() => toggleSort("messages")} active={sortBy === "messages"} dir={sortDir} right>
                            Messages
                          </Th>
                          <Th onClick={() => toggleSort("overdue")} active={sortBy === "overdue"} dir={sortDir} right>
                            Overdue
                          </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedUsers.map((u) => {
                          const expanded = expandedUserId === u.id;
                          return (
                            <UserRow
                              key={u.id}
                              user={u}
                              expanded={expanded}
                              onToggle={() =>
                                setExpandedUserId(expanded ? null : u.id)
                              }
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Recent activity rail */}
              <aside className="bg-white border border-slate-200 rounded-xl overflow-hidden h-fit lg:sticky lg:top-4">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Recent activity
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Last {data.activity.length} events
                  </p>
                </div>
                {data.activity.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No activity in this window.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                    {data.activity.map((a) => (
                      <li key={a.id} className="px-4 py-3 hover:bg-slate-50">
                        <div className="flex items-start gap-2">
                          <span className="text-base shrink-0 mt-0.5">
                            {activityIcon(a.type)}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs leading-snug">
                              <span className="font-medium text-slate-900">
                                {a.userName ?? "Someone"}
                              </span>{" "}
                              <span className="text-slate-700">{a.summary}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {timeAgo(a.when)}
                              {a.href && (
                                <>
                                  {" · "}
                                  <a
                                    href={a.href}
                                    className="text-wa-dark hover:underline"
                                  >
                                    open
                                  </a>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-1 leading-tight">
        {value}
      </div>
      {hint && <div className="text-[10px] text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  right,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: "asc" | "desc";
  right?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2 font-semibold cursor-pointer hover:text-slate-900 ${
        right ? "text-right" : "text-left"
      }`}
      onClick={onClick}
    >
      <span className={`inline-flex items-center gap-1 ${active ? "text-slate-900" : ""}`}>
        {children}
        {active && <span className="text-[8px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}

function UserRow({
  user,
  expanded,
  onToggle,
}: {
  user: PerUser;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <div className="font-medium text-slate-900">{user.name}</div>
          <div className="text-[10px] text-slate-500">{user.email}</div>
        </td>
        <td className="px-3 py-2.5 text-right">{user.assignedConversations}</td>
        <td className="px-3 py-2.5 text-right">
          <span className="font-medium">{user.quotationsSent}</span>
          {user.quotationsDraft > 0 && (
            <span className="text-[10px] text-slate-400 ml-1">
              +{user.quotationsDraft}d
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right font-medium">
          ₹{inr(user.quotationsValueInr)}
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="font-medium">{user.courtDesignsSent}</span>
          {user.courtDesignsDraft > 0 && (
            <span className="text-[10px] text-slate-400 ml-1">
              +{user.courtDesignsDraft}d
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right">{user.messagesSent}</td>
        <td className="px-3 py-2.5 text-right">
          {user.remindersOverdue > 0 ? (
            <span className="text-orange-600 font-medium">
              {user.remindersOverdue}
            </span>
          ) : (
            <span className="text-slate-400">0</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Pipeline distribution
                </div>
                {Object.keys(user.pipelineDistribution).length === 0 ? (
                  <div className="text-xs text-slate-400 italic">
                    No conversations in pipeline
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {Object.entries(user.pipelineDistribution)
                      .sort((a, b) => b[1] - a[1])
                      .map(([stage, count]) => (
                        <div
                          key={stage}
                          className="flex items-center gap-2 text-xs"
                        >
                          <div className="w-24 text-slate-600 capitalize">
                            {stage}
                          </div>
                          <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-wa-green h-full"
                              style={{
                                width: `${Math.min(100, (count / Math.max(1, user.assignedConversations)) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="text-slate-700 font-medium w-6 text-right">
                            {count}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Activity scoring
                </div>
                <ul className="text-xs text-slate-700 space-y-1.5">
                  <li>
                    📝 <strong>{user.notesWritten}</strong> notes written
                  </li>
                  <li>
                    🎯 <strong>{user.pipelineMoves}</strong> pipeline stage moves
                  </li>
                  <li>
                    ⏰ <strong>{user.remindersCompleted}</strong> reminders
                    completed
                    {user.remindersOverdue > 0 && (
                      <span className="ml-2 text-orange-600">
                        ({user.remindersOverdue} overdue)
                      </span>
                    )}
                  </li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <a
                    href={`/quotations?createdByUserId=${user.id}`}
                    className="px-2 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:border-slate-400"
                  >
                    See their quotes →
                  </a>
                  <a
                    href={`/pipeline?owner=${user.id}`}
                    className="px-2 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:border-slate-400"
                  >
                    See their pipeline →
                  </a>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function activityIcon(type: Activity["type"]): string {
  switch (type) {
    case "quote":
      return "📄";
    case "design":
      return "🎨";
    case "note":
      return "📝";
    case "pipeline":
      return "🎯";
  }
}

// Simple CSV export — no library needed, matches the spec's "every screen
// exports to CSV" requirement (§11.1) for these two tabs.
function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function SalesActivityTab({ rows }: { rows: SalesActivityRow[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Sales Activity</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            "Quotations sent" counts every send incl. revisions; "Unique deals quoted" counts each deal once regardless of revisions.
          </p>
        </div>
        <button
          onClick={() =>
            downloadCsv(
              `sales-activity-${new Date().toISOString().slice(0, 10)}.csv`,
              rows.map((r) => ({
                Salesperson: r.ownerName,
                "Leads created": r.leadsCreated,
                "Deals created": r.dealsCreated,
                "Site visits": r.siteVisits,
                "Samples sent": r.samplesSent,
                "Quotations sent (incl. revisions)": r.quotationsSentInclRevisions,
                "Unique deals quoted": r.uniqueDealsQuoted,
                "Quoted value": r.quotedValue,
                "Deals won": r.dealsWon,
                "Won value": r.wonValue,
                "Win rate": r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—",
                "Avg cycle days": r.avgCycleDays != null ? Math.round(r.avgCycleDays) : "—",
              })),
            )
          }
          className="text-xs font-medium text-wa-green hover:underline"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Salesperson</th>
              <th className="px-4 py-3 text-right">Leads</th>
              <th className="px-4 py-3 text-right">Deals</th>
              <th className="px-4 py-3 text-right">Site visits</th>
              <th className="px-4 py-3 text-right">Samples</th>
              <th className="px-4 py-3 text-right">Quotes sent</th>
              <th className="px-4 py-3 text-right">Unique deals quoted</th>
              <th className="px-4 py-3 text-right">Quoted value</th>
              <th className="px-4 py-3 text-right">Won</th>
              <th className="px-4 py-3 text-right">Won value</th>
              <th className="px-4 py-3 text-right">Win rate</th>
              <th className="px-4 py-3 text-right">Avg cycle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.ownerId} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{r.ownerName}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.leadsCreated}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.dealsCreated}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.siteVisits}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.samplesSent}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.quotationsSentInclRevisions}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.uniqueDealsQuoted}</td>
                <td className="px-4 py-3 text-right text-slate-600">{fmtInr(r.quotedValue)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.dealsWon}</td>
                <td className="px-4 py-3 text-right font-medium text-wa-green">{fmtInr(r.wonValue)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—"}</td>
                <td className="px-4 py-3 text-right text-slate-600">{r.avgCycleDays != null ? `${Math.round(r.avgCycleDays)}d` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FunnelTab({ data }: { data: FunnelPayload }) {
  const maxCount = Math.max(1, ...data.stages.map((s) => s.count));
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Pipeline snapshot</h3>
        <p className="text-xs text-slate-500 mb-4">Deals currently sitting in each stage, right now (not a historical cohort view).</p>
        <div className="space-y-2">
          {data.stages.map((s) => (
            <div key={s.stageId} className="flex items-center gap-3">
              <div className="w-36 text-xs text-slate-600 truncate" title={s.stageName}>{s.stageName}</div>
              <div className="flex-1 bg-slate-100 rounded-full h-6 relative overflow-hidden">
                <div
                  className={`h-full rounded-full ${s.stageType === "won" ? "bg-wa-green" : s.stageType === "lost" ? "bg-slate-400" : "bg-blue-400"}`}
                  style={{ width: `${(s.count / maxCount) * 100}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-slate-700">
                  {s.count} · {fmtInr(s.value)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Loss reasons (this period)</h3>
        {data.lossReasons.length === 0 ? (
          <p className="text-sm text-slate-400">No lost deals in this period.</p>
        ) : (
          <div className="space-y-2">
            {data.lossReasons.map((r) => (
              <div key={r.reasonName} className="flex justify-between text-sm">
                <span className="text-slate-600">{r.reasonName}</span>
                <span className="font-medium text-slate-900">{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GeographyTab({ data }: { data: GeographyPayload }) {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">By city</h3>
          <button
            onClick={() =>
              downloadCsv(
                `geography-cities-${new Date().toISOString().slice(0, 10)}.csv`,
                data.cities.map((r) => ({
                  City: r.city,
                  Enquiries: r.enquiries,
                  Quotations: r.quotations,
                  Won: r.won,
                  "Won value": r.wonValue,
                  "Win rate": r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—",
                  "Avg deal size": r.avgDealSize != null ? Math.round(r.avgDealSize) : "—",
                  "Avg cycle days": r.avgCycleDays != null ? Math.round(r.avgCycleDays) : "—",
                })),
              )
            }
            className="text-xs font-medium text-wa-green hover:underline"
          >
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">City</th>
                <th className="px-4 py-3 text-right">Enquiries</th>
                <th className="px-4 py-3 text-right">Quotations</th>
                <th className="px-4 py-3 text-right">Won</th>
                <th className="px-4 py-3 text-right">Won value</th>
                <th className="px-4 py-3 text-right">Win rate</th>
                <th className="px-4 py-3 text-right">Avg deal size</th>
                <th className="px-4 py-3 text-right">Avg cycle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.cities.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No deals in this period.</td>
                </tr>
              ) : (
                data.cities.map((r) => (
                  <tr key={r.city} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.city}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.enquiries}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.quotations}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.won}</td>
                    <td className="px-4 py-3 text-right font-medium text-wa-green">{fmtInr(r.wonValue)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.avgDealSize != null ? fmtInr(r.avgDealSize) : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.avgCycleDays != null ? `${Math.round(r.avgCycleDays)}d` : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">By tier</h3>
        {data.tiers.length === 0 ? (
          <p className="text-sm text-slate-400">No deals in this period.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {data.tiers.map((t) => (
              <div key={t.tierName} className="border border-slate-200 rounded-xl p-3">
                <div className="text-xs text-slate-500">{t.tierName}</div>
                <div className="text-lg font-bold text-slate-900">{t.enquiries}</div>
                <div className="text-[11px] text-slate-500">{t.won} won · {fmtInr(t.wonValue)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomersTab({ data }: { data: CustomersPayload }) {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">By customer segment</h3>
          <button
            onClick={() =>
              downloadCsv(
                `customer-segments-${new Date().toISOString().slice(0, 10)}.csv`,
                data.segments.map((r) => ({
                  Segment: r.profileName,
                  Enquiries: r.enquiries,
                  Won: r.won,
                  "Win rate": r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—",
                  "Avg deal size": r.avgDealSize != null ? Math.round(r.avgDealSize) : "—",
                  "Avg cycle days": r.avgCycleDays != null ? Math.round(r.avgCycleDays) : "—",
                })),
              )
            }
            className="text-xs font-medium text-wa-green hover:underline"
          >
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Segment</th>
                <th className="px-4 py-3 text-right">Enquiries</th>
                <th className="px-4 py-3 text-right">Won</th>
                <th className="px-4 py-3 text-right">Win rate</th>
                <th className="px-4 py-3 text-right">Avg deal size</th>
                <th className="px-4 py-3 text-right">Avg cycle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.segments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No deals in this period.</td>
                </tr>
              ) : (
                data.segments.map((r) => (
                  <tr key={r.profileName} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.profileName}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.enquiries}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.won}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.avgDealSize != null ? fmtInr(r.avgDealSize) : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.avgCycleDays != null ? `${Math.round(r.avgCycleDays)}d` : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">B2B vs B2C vs B2G</h3>
          {data.businessTypes.length === 0 ? (
            <p className="text-sm text-slate-400">No deals in this period.</p>
          ) : (
            <div className="space-y-2">
              {data.businessTypes.map((b) => (
                <div key={b.businessType} className="flex justify-between text-sm">
                  <span className="text-slate-600">{b.businessType}</span>
                  <span className="font-medium text-slate-900">{b.enquiries} enquiries · {b.won} won · {fmtInr(b.wonValue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Repeat customers</h3>
          <p className="text-xs text-slate-500 mb-2">Accounts with 2+ won deals, all time.</p>
          {data.repeatCustomers.length === 0 ? (
            <p className="text-sm text-slate-400">None yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {data.repeatCustomers.map((c) => (
                <div key={c.accountId} className="flex justify-between text-sm">
                  <span className="text-slate-700">{c.accountName}</span>
                  <span className="font-medium text-slate-900">{c.wonDeals}× · {fmtInr(c.totalWonValue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductsTab({ data }: { data: ProductsPayload }) {
  const topCities = useMemo(() => {
    const byCity = new Map<string, number>();
    for (const c of data.cityHeatmap) byCity.set(c.city, (byCity.get(c.city) ?? 0) + c.wonValue + c.enquiries);
    return [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([city]) => city);
  }, [data.cityHeatmap]);
  const cityRows = data.cityHeatmap.filter((c) => topCities.includes(c.city)).sort((a, b) => b.wonValue - a.wonValue || b.enquiries - a.enquiries);
  const hasRealCityData = data.cityHeatmap.some((c) => c.city !== "(unspecified)");

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">By product / cost category</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Enquiries count any deal with this item on it; conversion needs at least 5 quoted to show a rate.
            </p>
          </div>
          <button
            onClick={() =>
              downloadCsv(
                `product-conversion-${new Date().toISOString().slice(0, 10)}.csv`,
                data.conversion.map((r) => ({
                  Product: r.productName,
                  Enquiries: r.enquiries,
                  Quoted: r.quoted,
                  Won: r.won,
                  "Conversion rate": r.conversionRate != null ? `${Math.round(r.conversionRate * 100)}%` : "—",
                  Flagged: r.flagged ? "yes" : "",
                })),
              )
            }
            className="text-xs font-medium text-wa-green hover:underline"
          >
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Product / category</th>
                <th className="px-4 py-3 text-right">Enquiries</th>
                <th className="px-4 py-3 text-right">Quoted</th>
                <th className="px-4 py-3 text-right">Won</th>
                <th className="px-4 py-3 text-right">Conversion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.conversion.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No line items in this period.</td>
                </tr>
              ) : (
                data.conversion.map((r) => (
                  <tr key={r.productName} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {r.productName}
                      {r.flagged && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">
                          high enquiry, low conversion
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.enquiries}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.quoted}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.won}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.conversionRate != null ? `${Math.round(r.conversionRate * 100)}%` : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Product × City</h3>
        {!hasRealCityData ? (
          <p className="text-sm text-slate-400">
            Deals don't have a site city recorded yet — add one on each deal to unlock this breakdown.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">Top {topCities.length} cities by activity, won value.</p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-left">City</th>
                    <th className="px-3 py-2 text-right">Enquiries</th>
                    <th className="px-3 py-2 text-right">Won value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cityRows.map((r) => (
                    <tr key={`${r.productName}|${r.city}`}>
                      <td className="px-3 py-2 text-slate-700">{r.productName}</td>
                      <td className="px-3 py-2 text-slate-500">{r.city}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{r.enquiries}</td>
                      <td className="px-3 py-2 text-right font-medium text-wa-green">{fmtInr(r.wonValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Seasonality</h3>
        {data.distinctYears.length < 2 ? (
          <p className="text-sm text-slate-400">
            Needs at least 2 years of history to compare month-over-month across years — only {data.distinctYears.join(", ") || "0"} so far.
          </p>
        ) : (
          <p className="text-sm text-slate-500">{data.distinctYears.length} years of history available ({data.distinctYears.join(", ")}) — see monthly export for the year-over-year breakdown.</p>
        )}
      </div>
    </div>
  );
}

function SourcesTab({ data }: { data: SourcesPayload }) {
  const hasAnySpend = data.sources.some((s) => s.adSpend != null);
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">By lead source</h3>
            {!hasAnySpend && (
              <p className="text-xs text-slate-500 mt-0.5">
                Cost/lead, CAC and ROAS need ad spend figures — no spend has been entered yet, so those columns show "—".
              </p>
            )}
          </div>
          <button
            onClick={() =>
              downloadCsv(
                `lead-sources-${new Date().toISOString().slice(0, 10)}.csv`,
                data.sources.map((r) => ({
                  Source: r.sourceName,
                  Leads: r.leads,
                  Qualified: r.qualified,
                  Quoted: r.quoted,
                  Won: r.won,
                  "Won value": r.wonValue,
                  "Lead to won %": r.leadToWonRate != null ? `${Math.round(r.leadToWonRate * 100)}%` : "—",
                  "Avg cycle days": r.avgCycleDays != null ? Math.round(r.avgCycleDays) : "—",
                  "Ad spend": r.adSpend ?? "—",
                  "Cost per lead": r.costPerLead != null ? Math.round(r.costPerLead) : "—",
                  CAC: r.cac != null ? Math.round(r.cac) : "—",
                  ROAS: r.roas != null ? r.roas.toFixed(2) : "—",
                })),
              )
            }
            className="text-xs font-medium text-wa-green hover:underline"
          >
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-right">Leads</th>
                <th className="px-4 py-3 text-right">Qualified</th>
                <th className="px-4 py-3 text-right">Quoted</th>
                <th className="px-4 py-3 text-right">Won</th>
                <th className="px-4 py-3 text-right">Won value</th>
                <th className="px-4 py-3 text-right">Lead→Won</th>
                <th className="px-4 py-3 text-right">Avg cycle</th>
                <th className="px-4 py-3 text-right">Cost/lead</th>
                <th className="px-4 py-3 text-right">CAC</th>
                <th className="px-4 py-3 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.sources.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">No leads or deals in this period.</td>
                </tr>
              ) : (
                data.sources.map((r) => (
                  <tr key={r.sourceName} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.sourceName}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.leads}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.qualified}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.quoted}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.won}</td>
                    <td className="px-4 py-3 text-right font-medium text-wa-green">{fmtInr(r.wonValue)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.leadToWonRate != null ? `${Math.round(r.leadToWonRate * 100)}%` : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{r.avgCycleDays != null ? `${Math.round(r.avgCycleDays)}d` : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{r.costPerLead != null ? fmtInr(r.costPerLead) : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{r.cac != null ? fmtInr(r.cac) : "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{r.roas != null ? `${r.roas.toFixed(2)}×` : "—"}</td>
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

function DurationCard({ label, stat }: { label: string; stat: DurationStat }) {
  return (
    <div className="border border-slate-200 rounded-xl p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      {stat.n === 0 || stat.medianDays == null ? (
        <div className="text-sm text-slate-400 mt-1">Insufficient data{stat.n > 0 ? ` (n=${stat.n})` : ""}</div>
      ) : (
        <>
          <div className="text-lg font-bold text-slate-900 mt-0.5">{stat.medianDays.toFixed(1)}d <span className="text-xs font-normal text-slate-400">median</span></div>
          <div className="text-[11px] text-slate-500">p90 {stat.p90Days!.toFixed(1)}d · n={stat.n}</div>
        </>
      )}
    </div>
  );
}

function TimelinesTab({ data }: { data: TimelinesPayload }) {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Stage-to-stage timing</h3>
        <p className="text-xs text-slate-500 mb-3">Median and p90 (not mean — a few stalled deals would otherwise skew the average). Figures need at least 5 deals to show.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DurationCard label="Response time" stat={data.responseTime} />
          <DurationCard label="Enquiry → site visit" stat={data.enquiryToSiteVisit} />
          <DurationCard label="Site visit → quotation" stat={data.siteVisitToQuotation} />
          <DurationCard label="Quotation → negotiation" stat={data.quotationToNegotiation} />
          <DurationCard label="Negotiation → close" stat={data.negotiationToClose} />
          <DurationCard label="Site visit → closing" stat={data.siteVisitToClose} />
          <DurationCard label="Full cycle" stat={data.fullCycle} />
          <DurationCard label="Time in stage" stat={data.timeInStage} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Stuck deals</h3>
          <p className="text-xs text-slate-500 mt-0.5">No stage movement longer than the stage's SLA. Stages without a configured SLA use a 72-hour default.</p>
        </div>
        {data.stuckDeals.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Nothing stuck right now.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Deal</th>
                  <th className="px-4 py-3 text-left">Stage</th>
                  <th className="px-4 py-3 text-right">Days stuck</th>
                  <th className="px-4 py-3 text-right">SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.stuckDeals.map((d) => (
                  <tr key={d.dealId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <a href={`/deals/${d.dealId}`} className="font-medium text-slate-900 hover:text-wa-green hover:underline">{d.dealTitle}</a>
                      <div className="text-xs text-slate-400">{d.dealCode}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.stageName}</td>
                    <td className="px-4 py-3 text-right font-medium text-orange-600">{Math.round(d.daysSinceChange)}d</td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {Math.round(d.slaHours / 24)}d{d.usingDefaultSla && <span className="text-slate-400"> (default)</span>}
                    </td>
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

function ForecastTab({ data }: { data: ForecastPayload }) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Open deals with an expected close date" value={data.dealCount} />
        <Kpi label="Unweighted pipeline" value={`₹${inr(data.unweightedValue)}`} hint="sum of quoted value, no probability applied" />
        <Kpi
          label="Weighted pipeline"
          value={data.weightedValue != null ? `₹${inr(data.weightedValue)}` : "—"}
          hint={data.weightedValue != null ? "sum of quoted value × stage probability" : "no FunnelStage has a win probability configured yet"}
        />
      </section>

      {data.dealCount === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
          No open deals have an expected close date set yet — add one when creating or editing a deal to populate this forecast.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">By stage</h3>
            {!data.probabilitiesConfigured && (
              <p className="text-xs text-amber-600 mt-0.5">
                Showing unweighted totals — set a win probability on each pipeline stage (admin → taxonomies) to see a weighted forecast.
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Stage</th>
                  <th className="px-4 py-3 text-right">Deals</th>
                  <th className="px-4 py-3 text-right">Quoted value</th>
                  <th className="px-4 py-3 text-right">Win probability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byStage.map((s) => (
                  <tr key={s.stageName} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{s.stageName}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{s.count}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmtInr(s.value)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{s.probabilityPercent != null ? `${s.probabilityPercent}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function momChange(thisVal: number, lastVal: number): { pct: number | null; up: boolean } {
  if (lastVal === 0) return { pct: null, up: thisVal > 0 };
  const pct = ((thisVal - lastVal) / lastVal) * 100;
  return { pct, up: pct >= 0 };
}

function MomKpi({ label, thisVal, lastVal, isCurrency }: { label: string; thisVal: number; lastVal: number; isCurrency?: boolean }) {
  const { pct, up } = momChange(thisVal, lastVal);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1 leading-tight">{isCurrency ? `₹${inr(thisVal)}` : thisVal}</div>
      <div className={`text-[11px] mt-1 ${pct == null ? "text-slate-400" : up ? "text-wa-green" : "text-red-600"}`}>
        {pct == null ? `vs ${isCurrency ? "₹" + inr(lastVal) : lastVal} last month` : `${up ? "▲" : "▼"} ${Math.abs(Math.round(pct))}% vs last month`}
      </div>
    </div>
  );
}

function OverviewTab({ data }: { data: OverviewPayload }) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MomKpi label="Quotations sent" thisVal={data.thisMonth.quotationsSent} lastVal={data.lastMonth.quotationsSent} />
        <MomKpi label="Quoted value" thisVal={data.thisMonth.quotedValue} lastVal={data.lastMonth.quotedValue} isCurrency />
        <MomKpi label="Deals won" thisVal={data.thisMonth.dealsWon} lastVal={data.lastMonth.dealsWon} />
        <MomKpi label="Won value" thisVal={data.thisMonth.wonValue} lastVal={data.lastMonth.wonValue} isCurrency />
      </section>

      {data.stuckDealCount > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
          ⚠ <strong>{data.stuckDealCount}</strong> open {data.stuckDealCount === 1 ? "deal has" : "deals have"} had no stage movement past its SLA — see the Timelines tab.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Top movers</h3>
        <p className="text-xs text-slate-500 mb-3">Biggest change in won value this month vs last, by owner.</p>
        {data.topMovers.length === 0 ? (
          <p className="text-sm text-slate-400">No activity yet.</p>
        ) : (
          <div className="space-y-2">
            {data.topMovers.map((m) => (
              <div key={m.ownerName} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{m.ownerName}</span>
                <span className={`font-medium ${m.wonValueDelta > 0 ? "text-wa-green" : m.wonValueDelta < 0 ? "text-red-600" : "text-slate-400"}`}>
                  {m.wonValueDelta > 0 ? "+" : ""}
                  {fmtInr(m.wonValueDelta)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function inr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function rangeHint(r: Range): string {
  return r === "all" ? "all time" : `last ${r}`;
}
