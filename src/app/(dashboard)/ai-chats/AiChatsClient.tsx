"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { formatWhen } from "@/lib/agent/approvalFormat";
import type { AiChatRow, AiChatsResult } from "@/lib/ai-chats/query";
import type { Temperature } from "@/lib/ai-chats/scoring";

type Filter = Temperature | "ALL";
type Line = {
  id: string;
  from: "customer" | "ai" | "staff";
  staffName: string | null;
  type: string;
  body: string | null;
  createdAt: string;
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "HOT", label: "🔥 Hot" },
  { key: "WARM", label: "🌤 Warm" },
  { key: "COLD", label: "❄️ Cold" },
];

const BADGE: Record<Temperature, string> = {
  HOT: "bg-red-100 text-red-700 border-red-200",
  WARM: "bg-amber-100 text-amber-800 border-amber-200",
  COLD: "bg-sky-100 text-sky-700 border-sky-200",
};
const LABEL: Record<Temperature, string> = { HOT: "🔥 Hot", WARM: "🌤 Warm", COLD: "❄️ Cold" };
const SOURCE: Record<AiChatRow["source"], string> = { auto: "Auto", agent: "AI agent", human: "Team" };
const HANDOFF: Record<string, string> = {
  PENDING: "Asked for a person — waiting",
  APPROVED: "With a salesperson",
  REJECTED: "Asked for a person — declined",
  RELEASED: "Back with AI",
};

export default function AiChatsClient({
  initial,
  seesAll,
  canLabelAll,
  currentUserId,
}: {
  initial: AiChatsResult;
  seesAll: boolean;
  canLabelAll: boolean;
  currentUserId: string;
}) {
  const toast = useToast();
  const [data, setData] = useState<AiChatsResult>(initial);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Line[] | "error">>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const latest = useRef(0);
  const first = useRef(true);

  const load = useCallback(async (query: string) => {
    const ticket = ++latest.current;
    setLoading(true);
    const res = await safeFetch(`/api/ai-chats?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (ticket !== latest.current) return;
    setLoading(false);
    if (!res.ok || !json) {
      toast.error("Could not load the chats. Please try again.");
      return;
    }
    setData(json as AiChatsResult);
  }, [toast]);

  // Search as you type (debounced); the first render already has the data.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  async function toggle(row: AiChatRow) {
    if (openId === row.conversationId) {
      setOpenId(null);
      return;
    }
    setOpenId(row.conversationId);
    if (lines[row.conversationId] && lines[row.conversationId] !== "error") return;
    const res = await safeFetch(`/api/ai-chats/${row.conversationId}/messages`, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    setLines((m) => ({ ...m, [row.conversationId]: res.ok && json ? (json.messages as Line[]) : "error" }));
  }

  async function relabel(row: AiChatRow, value: string) {
    if (busyId) return;
    setBusyId(row.conversationId);
    const res = await safeFetch(`/api/ai-chats/${row.conversationId}/temperature`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperature: value === "AUTO" ? null : value }),
    });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error((json as { error?: string }).error ?? "Could not change the label.");
      return;
    }
    toast.success(value === "AUTO" ? "Back to the automatic label." : "Label saved.");
    void load(q);
  }

  async function claim(row: AiChatRow) {
    if (busyId) return;
    setBusyId(row.conversationId);
    const res = await safeFetch(`/api/ai-chats/${row.conversationId}/claim`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error((json as { error?: string }).error ?? "Could not take this lead.");
      void load(q);
      return;
    }
    toast.success("It's yours. The chat is in your Inbox and the AI will stay quiet there.");
    void load(q);
  }

  const rows = filter === "ALL" ? data.rows : data.rows.filter((r) => r.temperature === filter);

  return (
    <div className="min-h-full">
      <PageHeader
        title="AI agent chats"
        description={
          seesAll
            ? "Every WhatsApp chat the AI sales agent has handled, hot leads first."
            : "WhatsApp chats the AI sales agent handled that are assigned to you, plus unassigned hot leads you can take."
        }
        large
      />
      <div className="px-4 sm:px-6 lg:px-8 py-4 max-w-6xl space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`card p-3 text-left transition ${filter === f.key ? "ring-2 ring-[var(--ac)]" : "hover:bg-slate-50"}`}
            >
              <div className="text-xs text-slate-500">{f.label}</div>
              <div className="text-2xl font-bold text-slate-900">{data.counts[f.key]}</div>
            </button>
          ))}
        </div>

        <input
          className="input w-full sm:max-w-sm"
          placeholder="Search by name or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search chats"
        />

        {data.truncated && (
          <p className="text-xs text-slate-500">Showing the {data.rows.length} most recently active AI chats.</p>
        )}

        {loading && rows.length === 0 ? (
          <div className="card p-6 text-sm text-slate-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="card p-6 text-sm text-slate-500">
            {data.counts.ALL === 0 ? "The AI agent has not handled any chats yet." : "No chats match."}
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const open = openId === r.conversationId;
              const transcript = lines[r.conversationId];
              return (
                <li key={r.conversationId} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[r.temperature]}`}>
                          {LABEL[r.temperature]}
                        </span>
                        <span className="text-xs text-slate-500">
                          {SOURCE[r.source]}
                          {r.source === "auto" && ` · score ${r.score}`}
                        </span>
                        <h2 className="text-base font-bold text-slate-900 truncate">{r.name || r.phone}</h2>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {r.phone}
                        {r.assignedTo ? <span> · with {r.assignedTo}</span> : <span className="font-semibold text-orange-700"> · Unassigned</span>}
                        {r.handoffStatus && <span> · {HANDOFF[r.handoffStatus] ?? r.handoffStatus}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 sm:text-right">
                      {r.lastActivityAt && <div>Last activity {formatWhen(r.lastActivityAt)}</div>}
                      <div>
                        {r.aiMessageCount} AI · {r.customerMessageCount} customer messages
                      </div>
                    </div>
                  </div>

                  {r.reason && <p className="mt-2 text-sm text-slate-800 break-words">{r.reason}</p>}

                  {r.requirements.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.requirements.map((x) => (
                        <span key={x.label} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {x.label}: <span className="font-semibold">{x.value}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {r.claimable && (
                      <button className="btn btn-turf" disabled={busyId !== null} onClick={() => void claim(r)}>
                        {busyId === r.conversationId ? "Working…" : "🙋 Take this lead"}
                      </button>
                    )}
                    <button className="btn btn-secondary" onClick={() => void toggle(r)} aria-expanded={open}>
                      {open ? "Hide conversation" : "View conversation"}
                    </button>
                    <a className="btn btn-secondary" href={`/inbox?conversation=${r.conversationId}`}>
                      Open in Inbox
                    </a>
                    {r.leadId && (
                      <a className="btn btn-secondary" href={`/crm/contacts/${r.leadId}`} target="_blank" rel="noreferrer">
                        CRM lead
                      </a>
                    )}
                    {(canLabelAll || r.assignedToUserId === currentUserId) && (
                      <select
                        className="input w-auto"
                        aria-label="Change label"
                        value={r.source === "human" ? r.temperature : "AUTO"}
                        disabled={busyId !== null}
                        onChange={(e) => void relabel(r, e.target.value)}
                      >
                        <option value="AUTO">Label: automatic / AI</option>
                        <option value="HOT">Mark hot</option>
                        <option value="WARM">Mark warm</option>
                        <option value="COLD">Mark cold</option>
                      </select>
                    )}
                  </div>

                  {open && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-96 overflow-y-auto space-y-2">
                      {transcript === undefined ? (
                        <div className="text-sm text-slate-500">Loading…</div>
                      ) : transcript === "error" ? (
                        <div className="text-sm text-red-700">Could not load the conversation.</div>
                      ) : transcript.length === 0 ? (
                        <div className="text-sm text-slate-500">No messages.</div>
                      ) : (
                        transcript.map((m) => (
                          <div key={m.id} className={`flex ${m.from === "customer" ? "justify-start" : "justify-end"}`}>
                            <div
                              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                                m.from === "customer"
                                  ? "bg-white border border-slate-200 text-slate-900"
                                  : m.from === "ai"
                                    ? "bg-violet-100 text-violet-950"
                                    : "bg-emerald-100 text-emerald-950"
                              }`}
                            >
                              <div className="text-[11px] font-semibold opacity-70">
                                {m.from === "customer" ? "Customer" : m.from === "ai" ? "AI agent" : m.staffName || "Team"} ·{" "}
                                {formatWhen(m.createdAt)}
                              </div>
                              {m.body || <span className="italic opacity-70">[{m.type}]</span>}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
