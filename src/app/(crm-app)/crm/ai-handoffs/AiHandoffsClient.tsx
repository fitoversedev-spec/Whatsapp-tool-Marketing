"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { formatWhen } from "@/lib/agent/approvalFormat";
import type { HandoffCard } from "@/lib/agent/handoffs/admin";
import type { HandoffStatus } from "@/lib/agent/handoffs/logic";

type Assignee = { id: string; name: string; role: string };

const TABS: { key: HandoffStatus; label: string; approverOnly?: boolean }[] = [
  { key: "PENDING", label: "Waiting", approverOnly: true },
  { key: "APPROVED", label: "With salesperson" },
  { key: "RELEASED", label: "Back with AI" },
  { key: "REJECTED", label: "Declined", approverOnly: true },
];

const EMPTY: Record<HandoffStatus, string> = {
  PENDING: "No customer is waiting for a person.",
  APPROVED: "No chats are with a salesperson right now.",
  RELEASED: "Nothing here yet.",
  REJECTED: "Nothing here yet.",
};

export default function AiHandoffsClient({
  approver,
  initialTab,
  initialItems,
  initialPendingCount,
  assignees,
}: {
  approver: boolean;
  initialTab: HandoffStatus;
  initialItems: HandoffCard[];
  initialPendingCount: number;
  assignees: Assignee[];
}) {
  const toast = useToast();
  const [tab, setTab] = useState<HandoffStatus>(initialTab);
  const [items, setItems] = useState<HandoffCard[]>(initialItems);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const latest = useRef(0);
  const first = useRef(true);

  const load = useCallback(async (next: HandoffStatus) => {
    const ticket = ++latest.current;
    setLoading(true);
    setLoadError(false);
    const res = await safeFetch(`/api/admin/agent/handoffs?status=${next}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (ticket !== latest.current) return; // a newer tab click won
    setLoading(false);
    if (!res.ok || !data) {
      setLoadError(true);
      return;
    }
    setItems(data.items as HandoffCard[]);
    setPendingCount(data.pendingCount as number);
  }, []);

  // The first render already has the initial tab from the server.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(tab);
  }, [tab, load]);

  function pick(next: HandoffStatus) {
    if (next === tab) return;
    setItems([]);
    setTab(next);
  }

  // Suggest the lead's current rep when they can take chats.
  const defaultPick = (c: HandoffCard) =>
    c.lead?.ownerId && assignees.some((a) => a.id === c.lead?.ownerId) ? c.lead.ownerId : "";

  async function act(card: HandoffCard, action: "approve" | "reject" | "release") {
    if (busyId) return;
    const assignToUserId = picks[card.id] ?? defaultPick(card);
    if (action === "approve" && !assignToUserId) {
      toast.error("Pick a salesperson first.");
      return;
    }
    setBusyId(card.id);
    const note = (notes[card.id] ?? "").trim();
    const body = action === "approve" ? { assignToUserId, note } : action === "reject" ? { note } : {};
    const res = await safeFetch(`/api/admin/agent/handoffs/${card.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast.error((data as { error?: string }).error ?? "Something went wrong. Please try again.");
      if (res.status === 409 || res.status === 404) void load(tab);
      return;
    }
    setItems((prev) => prev.filter((c) => c.id !== card.id));
    if (card.status === "PENDING") setPendingCount((n) => Math.max(0, n - 1));
    if (action === "approve") toast.success("Assigned. The AI will stay quiet in this chat.");
    else if (action === "reject") toast.success("Declined. The AI agent carries on with the chat.");
    else toast.success("Handed back to the AI agent.");
  }

  const tabs = TABS.filter((t) => approver || !t.approverOnly);

  return (
    <div className="min-h-full">
      <PageHeader
        title="AI handoffs"
        description={
          approver
            ? "Customers who asked the AI agent for a person. Pick a salesperson to take over the chat; the AI stops replying there until it is handed back."
            : "Chats the AI agent handed to you. When you are done, hand the chat back so the AI can carry on."
        }
        large
      />
      <div className="px-4 sm:px-6 lg:px-8 py-4 max-w-4xl">
        <div className="flex flex-wrap gap-2 mb-4" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => pick(t.key)}
              className={`btn ${tab === t.key ? "btn-primary" : "btn-secondary"}`}
            >
              {t.label}
              {t.key === "PENDING" && pendingCount > 0 && (
                <span className="ml-2 rounded-full bg-white/80 px-1.5 text-xs font-bold text-slate-900">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {loadError ? (
          <div className="card p-6 text-sm text-slate-700">
            Could not load the list. Please try again.
            <button className="btn btn-secondary ml-3" onClick={() => void load(tab)}>
              Try again
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="card p-6 text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="card p-6 text-sm text-slate-500">{EMPTY[tab]}</div>
        ) : (
          <ul className="space-y-4">
            {items.map((c) => (
              <li key={c.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-lg font-bold text-slate-900">
                    {c.conversation.name || c.lead?.name || c.conversation.phone}
                  </h2>
                  <div className="text-xs text-slate-500 sm:text-right">Asked {formatWhen(c.requestedAt)}</div>
                </div>

                <div className="mt-2 text-sm text-slate-700 space-y-1">
                  <div>
                    <span className="text-slate-500">WhatsApp: </span>
                    <span className="font-semibold">{c.conversation.phone}</span>
                    <a
                      href={`/inbox?conversation=${c.conversation.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-blue-600 hover:underline"
                    >
                      Open chat
                    </a>
                  </div>
                  {c.lead && (
                    <div>
                      <span className="text-slate-500">Lead: </span>
                      <span className="font-semibold">{c.lead.name}</span>
                      {c.lead.company && <span className="text-slate-600"> · {c.lead.company}</span>}
                      {c.lead.ownerName && <span className="text-slate-600"> · rep {c.lead.ownerName}</span>}
                      <a
                        href={`/crm/contacts/${c.lead.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-blue-600 hover:underline"
                      >
                        Open
                      </a>
                    </div>
                  )}
                </div>

                <dl className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-sm text-slate-500">Why they want a person:</dt>
                    <dd className="text-sm font-semibold text-slate-900 break-words">{c.reason}</dd>
                  </div>
                  {c.summary && (
                    <div>
                      <dt className="text-sm text-slate-500">Requirements gathered by the AI:</dt>
                      <dd className="mt-1 rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 whitespace-pre-wrap break-words">
                        {c.summary}
                      </dd>
                    </div>
                  )}
                </dl>

                {c.status === "PENDING" && approver ? (
                  <div className="mt-4 border-t border-slate-200 pt-3 space-y-3">
                    <label className="block text-sm">
                      <span className="text-slate-500">Assign to</span>
                      <select
                        className="input w-full mt-1"
                        value={picks[c.id] ?? defaultPick(c)}
                        onChange={(e) => setPicks((p) => ({ ...p, [c.id]: e.target.value }))}
                        disabled={busyId === c.id}
                      >
                        <option value="">Choose a salesperson…</option>
                        {assignees.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.role})
                          </option>
                        ))}
                      </select>
                    </label>
                    <textarea
                      className="input w-full"
                      rows={2}
                      maxLength={500}
                      placeholder="Add a note (optional)"
                      value={notes[c.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                      disabled={busyId === c.id}
                    />
                    <div className="flex gap-2">
                      <button className="btn btn-turf" disabled={busyId !== null} onClick={() => void act(c, "approve")}>
                        {busyId === c.id ? "Working…" : "Approve & assign"}
                      </button>
                      <button className="btn btn-secondary" disabled={busyId !== null} onClick={() => void act(c, "reject")}>
                        Decline (AI continues)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-700 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.assignedTo && (
                        <span>
                          With <span className="font-semibold">{c.assignedTo.name}</span>
                        </span>
                      )}
                      {c.decidedAt && (
                        <span className="text-slate-500">
                          decided by {c.decidedBy?.name ?? "someone"} · {formatWhen(c.decidedAt)}
                        </span>
                      )}
                    </div>
                    {c.decisionNote && <div>Note: {c.decisionNote}</div>}
                    {c.status === "APPROVED" && (
                      <button className="btn btn-secondary" disabled={busyId !== null} onClick={() => void act(c, "release")}>
                        {busyId === c.id ? "Working…" : "Hand back to AI"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
