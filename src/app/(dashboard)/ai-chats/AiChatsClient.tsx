"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  REJECTED: "Request declined",
  RELEASED: "Released",
};

type Assignee = { id: string; name: string; role: string };
type TemplateChoice = { id: string; name: string; category: string; language: string; body: string };

export default function AiChatsClient({
  initial,
  seesAll,
  canLabelAll,
  currentUserId,
  canAssign,
  assignees,
}: {
  initial: AiChatsResult;
  seesAll: boolean;
  canLabelAll: boolean;
  currentUserId: string;
  /** Admins (AI approvers) assign leads directly and pick the welcome templates. */
  canAssign: boolean;
  assignees: Assignee[];
}) {
  const toast = useToast();
  const params = useSearchParams();
  const [picks, setPicks] = useState<Record<string, string>>({});
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

  async function post(row: AiChatRow, action: "request" | "assign", body?: unknown) {
    if (busyId) return false;
    setBusyId(row.conversationId);
    const res = await safeFetch(`/api/ai-chats/${row.conversationId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    void load(q);
    if (!res.ok) {
      toast.error((json as { error?: string }).error ?? "Something went wrong. Please try again.");
      return false;
    }
    return true;
  }

  async function requestLead(row: AiChatRow) {
    if (await post(row, "request")) toast.success("Sent to the admin for approval.");
  }

  async function assign(row: AiChatRow) {
    const to = picks[row.conversationId];
    if (!to) {
      toast.error("Pick a salesperson first.");
      return;
    }
    if (await post(row, "assign", { assignToUserId: to })) {
      toast.success("Assigned. They got the handover, and the AI introduced them to the customer if the chat is open.");
    }
  }

  // Opened from a notification (/ai-chats?c=<id>): show that conversation.
  const deepLinked = useRef(false);
  useEffect(() => {
    const c = params.get("c");
    if (!c || deepLinked.current) return;
    const row = data.rows.find((r) => r.conversationId === c);
    if (!row) return;
    deepLinked.current = true;
    void toggle(row);
    setTimeout(() => document.getElementById(`chat-${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, data.rows]);

  const rows = filter === "ALL" ? data.rows : data.rows.filter((r) => r.temperature === filter);

  return (
    <div className="min-h-full">
      <PageHeader
        title="AI agent chats"
        description={
          seesAll
            ? "Every WhatsApp chat the AI sales agent has handled, hot leads first."
            : "WhatsApp chats the AI sales agent handled that are assigned to you, plus unassigned hot leads you can ask for."
        }
        large
      />
      <div className="px-4 sm:px-6 lg:px-8 py-4 max-w-6xl space-y-4">
        {canAssign && <WelcomeTemplates />}
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
                <li key={r.conversationId} id={`chat-${r.conversationId}`} className="card p-4 scroll-mt-4">
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
                        {r.handoffStatus && HANDOFF[r.handoffStatus] && <span> · {HANDOFF[r.handoffStatus]}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 sm:text-right">
                      {r.lastActivityAt && <div>Last activity {formatWhen(r.lastActivityAt)}</div>}
                      <div>
                        {r.aiMessageCount} AI · {r.customerMessageCount} customer messages
                      </div>
                    </div>
                  </div>

                  {r.pendingRequest && (
                    <div className="mt-2 inline-block rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-800">
                      {r.pendingRequest.kind === "SALES_REQUEST"
                        ? `${r.pendingRequest.requestedBy ?? "A salesperson"} asked for this lead — waiting for admin`
                        : "Customer asked to talk to a person — waiting for admin"}
                    </div>
                  )}

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
                    {r.requestable && (
                      <button className="btn btn-turf" disabled={busyId !== null} onClick={() => void requestLead(r)}>
                        {busyId === r.conversationId ? "Working…" : "🙋 Request this lead"}
                      </button>
                    )}
                    {canAssign && r.handoffStatus !== "APPROVED" && (
                      <span className="flex items-center gap-2">
                        <select
                          className="input w-auto"
                          aria-label="Assign to"
                          value={picks[r.conversationId] ?? ""}
                          disabled={busyId !== null}
                          onChange={(e) => setPicks((p) => ({ ...p, [r.conversationId]: e.target.value }))}
                        >
                          <option value="">Assign to…</option>
                          {assignees.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.role})
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-turf"
                          disabled={busyId !== null || !picks[r.conversationId]}
                          onClick={() => void assign(r)}
                        >
                          {busyId === r.conversationId ? "Working…" : "Assign"}
                        </button>
                      </span>
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

/** Admin panel: the templates the AI may send on its own as the first message to a new form lead. */
function WelcomeTemplates() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateChoice[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await safeFetch("/api/ai-chats/welcome-templates", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) return;
      setTemplates(json.templates as TemplateChoice[]);
      setSelected(json.selected as string[]);
    })();
  }, []);

  async function save() {
    setSaving(true);
    const res = await safeFetch("/api/ai-chats/welcome-templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateIds: selected }),
    });
    setSaving(false);
    if (res.ok) toast.success("Welcome templates saved.");
    else toast.error("Could not save. Please try again.");
  }

  const names = (templates ?? []).filter((t) => selected.includes(t.id)).map((t) => t.name);
  return (
    <div className="card p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <span className="font-semibold text-slate-900">Welcome templates for new form leads</span>
          <span className="block text-xs text-slate-500">
            {names.length
              ? `The AI sends ${names.join(", ")} to each new Instagram/Facebook form lead, once.`
              : "None set: the AI cannot message new form leads until you pick one."}
          </span>
        </span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {templates === null ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="text-sm text-slate-500">No WhatsApp-approved templates yet. Create one under Templates first.</div>
          ) : (
            templates.map((t) => (
              <label key={t.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(t.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                />
                <span className="min-w-0">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-xs text-slate-500">
                    {" "}
                    · {t.category} · {t.language}
                  </span>
                  <span className="block text-slate-600 whitespace-pre-wrap break-words">{t.body}</span>
                </span>
              </label>
            ))
          )}
          <button className="btn btn-primary" disabled={saving || templates === null} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
