"use client";

// Sales team analytics dashboard. Top: range picker + team-wide KPI
// cards. Middle: sortable per-salesperson table with click-to-expand
// drill-down (pipeline distribution + reminders + activity scoring).
// Right rail: recent activity feed (last 25 events across all sources).

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";

type Range = "7d" | "30d" | "90d" | "all";

type PerUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "sales";
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
};

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

        {data && (
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
