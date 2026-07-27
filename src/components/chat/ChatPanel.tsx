"use client";

// The launcher's open panel: an inbox of the current user's threads, and the
// selected thread's conversation. Fixed bottom-right on desktop, full-screen on
// mobile. State lives here so "minimize" (parent hides this) preserves it.
import { useCallback, useEffect, useState } from "react";
import ChatThreadView from "./ChatThreadView";
import SetLeaveModal from "./SetLeaveModal";
import HandoffModal from "./HandoffModal";

type ChatEntityType = "account_contact" | "deal" | "team" | "dm";
type ThreadItem = {
  threadId: string;
  entityType: ChatEntityType;
  entityId: string;
  label: string;
  sublabel: string;
  unreadCount: number;
  lastMessageAt: string | null;
};
type HandoffItem = {
  id: string;
  kind: "COVERAGE" | "TAKEOVER";
  status: string;
  label: string;
  fromName: string;
  toName: string;
  note: string | null;
  coverageEnd: string | null;
  canRespond: boolean;
  canApprove: boolean;
  mine: boolean;
};
type Leave = { id: string; userName: string; mine: boolean; startsAt: string; endsAt: string; note: string | null };

export default function ChatPanel({
  onMinimize,
  onClose,
  onActivity,
}: {
  onMinimize: () => void;
  onClose: () => void;
  // Bubble a read/refresh up so the launcher badge re-polls.
  onActivity: () => void;
}) {
  const [view, setView] = useState<"inbox" | "thread">("inbox");
  const [current, setCurrent] = useState<{ entityType: ChatEntityType; entityId: string; label: string } | null>(null);
  const [threads, setThreads] = useState<ThreadItem[] | null>(null);
  const [requests, setRequests] = useState<HandoffItem[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [showLeave, setShowLeave] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  function openThread(entityType: ChatEntityType, entityId: string, label: string) {
    setCurrent({ entityType, entityId, label });
    setView("thread");
  }

  const loadInbox = useCallback(async () => {
    try {
      const [t, h, a] = await Promise.all([
        fetch("/api/chat/threads").then((r) => (r.ok ? r.json() : { threads: [] })),
        fetch("/api/chat/handoffs").then((r) => (r.ok ? r.json() : { requests: [] })),
        fetch("/api/chat/availability").then((r) => (r.ok ? r.json() : { leaves: [] })),
      ]);
      setThreads(t.threads ?? []);
      setRequests(h.requests ?? []);
      setLeaves(a.leaves ?? []);
    } catch {
      setThreads((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    if (view === "inbox") loadInbox();
  }, [view, loadInbox]);

  async function handoffAction(id: string, action: "accept" | "decline" | "approve" | "cancel") {
    setBusyId(id);
    try {
      await fetch(`/api/chat/handoffs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await loadInbox();
      onActivity();
    } finally {
      setBusyId(null);
    }
  }

  // Requests that still need an action from this user (respond or approve).
  const actionable = requests.filter((r) => r.canRespond || r.canApprove);

  return (
    <div className="fixed z-50 flex flex-col bg-white shadow-2xl border border-slate-200 right-4 bottom-4 w-[380px] h-[560px] rounded-xl max-sm:inset-0 max-sm:w-full max-sm:h-full max-sm:rounded-none">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200 shrink-0">
        {view === "thread" ? (
          <button onClick={() => { setView("inbox"); onActivity(); }} className="text-slate-500 hover:text-slate-800 text-sm" title="Back to chats">←</button>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-wa-green" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">
            {view === "thread" ? current?.label : "Team chat"}
          </div>
          {view === "inbox" && <div className="text-[10px] text-slate-400">Internal — your customers &amp; deals</div>}
        </div>
        <button onClick={onMinimize} title="Minimize" className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 leading-none">—</button>
        <button onClick={onClose} title="Close" className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 text-base leading-none">✕</button>
      </div>

      {/* Body */}
      {view === "inbox" ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {actionable.length > 0 && (
            <div className="bg-amber-50/50 border-b border-amber-100">
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Requests</div>
              {actionable.map((r) => (
                <div key={r.id} className="px-3 py-2 border-t border-amber-100/60 first:border-t-0">
                  <div className="text-xs text-slate-700">
                    <span className="font-medium">{r.kind === "COVERAGE" ? "Cover" : "Take over"}</span> · {r.label}
                    {r.canApprove ? ` — ${r.toName} accepted` : ` — from ${r.fromName}`}
                    {r.kind === "COVERAGE" && r.coverageEnd ? ` (until ${new Date(r.coverageEnd).toLocaleDateString()})` : ""}
                  </div>
                  {r.note && <div className="text-[11px] text-slate-500 mt-0.5">{r.note}</div>}
                  <div className="flex gap-2 mt-1.5">
                    {r.canRespond && (
                      <>
                        <button disabled={busyId === r.id} onClick={() => handoffAction(r.id, "accept")} className="text-xs font-medium bg-wa-green text-white rounded px-2.5 py-1 disabled:opacity-50">Accept</button>
                        <button disabled={busyId === r.id} onClick={() => handoffAction(r.id, "decline")} className="text-xs font-medium border border-slate-300 rounded px-2.5 py-1 disabled:opacity-50">Decline</button>
                      </>
                    )}
                    {r.canApprove && (
                      <>
                        <button disabled={busyId === r.id} onClick={() => handoffAction(r.id, "approve")} className="text-xs font-medium bg-wa-green text-white rounded px-2.5 py-1 disabled:opacity-50">Approve</button>
                        <button disabled={busyId === r.id} onClick={() => handoffAction(r.id, "decline")} className="text-xs font-medium border border-slate-300 rounded px-2.5 py-1 disabled:opacity-50">Reject</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-slate-500 truncate">
              {leaves.length
                ? leaves.map((l) => `${l.mine ? "You" : l.userName} away → ${new Date(l.endsAt).toLocaleDateString()}`).join(" · ")
                : "Everyone's in"}
            </div>
            <div className="shrink-0 flex items-center gap-3">
              <button onClick={() => setShowHandoff(true)} className="text-[11px] font-medium text-wa-dark hover:underline">🤝 Hand off</button>
              <button onClick={() => setShowLeave(true)} className="text-[11px] font-medium text-wa-dark hover:underline">🏖️ Set leave</button>
            </div>
          </div>

          {threads === null ? (
            <div className="text-center text-xs text-slate-400 py-8">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-8 px-4">
              No chats yet. Open a customer or deal and start a Team chat, or @-mention a teammate.
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.threadId}
                onClick={() => openThread(t.entityType, t.entityId, t.label)}
                className="w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{t.label}</div>
                  <div className="text-[11px] text-slate-400">{t.sublabel}</div>
                </div>
                {t.unreadCount > 0 && (
                  <span className="shrink-0 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none">
                    {t.unreadCount > 99 ? "99+" : t.unreadCount}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      ) : current ? (
        <div className="flex-1 min-h-0">
          <ChatThreadView entityType={current.entityType} entityId={current.entityId} onRead={onActivity} />
        </div>
      ) : null}

      {showLeave && (
        <SetLeaveModal
          onClose={() => setShowLeave(false)}
          onDone={() => {
            setShowLeave(false);
            loadInbox();
          }}
        />
      )}

      {showHandoff && (
        <HandoffModal
          onClose={() => setShowHandoff(false)}
          onDone={() => {
            setShowHandoff(false);
            loadInbox();
            onActivity();
          }}
        />
      )}
    </div>
  );
}
