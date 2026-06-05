"use client";

import { useState, useEffect, useRef, useMemo, FormEvent } from "react";
import { useToast } from "@/components/Toast";

type Conversation = {
  id: string;
  contactPhone: string;
  contactName: string | null;
  assignedToName: string | null;
  assignedToUserId: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  unreadCount: number;
  status: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  status: string;
  createdAt: string;
  sentByName?: string | null;
};

type AssignableUser = { id: string; name: string; role: "admin" | "sales"; email: string };

export default function InboxClient({
  currentUser,
  initialConversations,
}: {
  currentUser: { id: string; name: string; role: "admin" | "sales" };
  initialConversations: Conversation[];
}) {
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [withinWindow, setWithinWindow] = useState<boolean>(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("open");
  const [showReassign, setShowReassign] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);

  // Filter: status + search (phone/name client-side; message content is a separate server call below)
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !c.contactPhone.toLowerCase().includes(q) &&
          !(c.contactName ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [conversations, statusFilter, search]);

  // Poll every 15s
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/conversations?q=${encodeURIComponent(search)}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations);
      }
    }, 15000);
    return () => clearInterval(t);
  }, [search]);

  // When search changes, fetch with q (server can also search message content)
  useEffect(() => {
    const id = setTimeout(async () => {
      const res = await fetch(`/api/conversations?q=${encodeURIComponent(search)}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Load messages when selection changes
  useEffect(() => {
    if (!selected) return;
    fetch(`/api/conversations/${selected}/messages`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages ?? []);
        setWithinWindow(data.withinWindow ?? false);
      });
  }, [selected]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  // Pre-fetch assignable users for admin
  useEffect(() => {
    if (currentUser.role !== "admin") return;
    fetch("/api/users/assignable")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((data) => setAssignableUsers(data.users ?? []));
  }, [currentUser.role]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selected}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
        setReply("");
      } else {
        const err = await res.json().catch(() => ({}));
        // If 24h window expired, update local state so the UI disables correctly
        if (res.status === 422) {
          setWithinWindow(false);
        }
        toast.error(err.error ?? "Send failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSending(false);
    }
  }

  async function patchConversation(body: Record<string, unknown>, successMsg: string) {
    if (!selected) return;
    const res = await fetch(`/api/conversations/${selected}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success(successMsg);
      // Refresh conversation list
      const list = await fetch(`/api/conversations?q=${encodeURIComponent(search)}`).then((r) => r.json());
      setConversations(list.conversations);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Update failed");
    }
  }

  const current = conversations.find((c) => c.id === selected);
  const isClosed = current?.status === "closed";

  return (
    <div className="flex flex-1 lg:h-screen h-[calc(100vh-3.5rem)] lg:items-stretch">
      {/* Conversation list */}
      <div
        className={`
          w-full lg:w-80 border-r border-slate-200 bg-white flex-col
          ${selected ? "hidden lg:flex" : "flex"}
        `}
      >
        <div className="px-4 py-4 border-b border-slate-200 shrink-0 space-y-3">
          <div>
            <h2 className="font-semibold text-slate-900">Conversations</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {currentUser.role === "admin" ? "Showing all" : "Your assigned + unassigned"}
            </p>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search phone, name, or message…"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none text-sm"
          />
          <div className="flex gap-1.5">
            {(["open", "closed", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex-1 text-xs font-medium px-2 py-1.5 rounded-md transition ${
                  statusFilter === s
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {s === "open" ? "Open" : s === "closed" ? "Closed" : "All"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No conversations yet. They&apos;ll appear when customers reply.
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {search ? `No matches for "${search}".` : `No ${statusFilter} conversations.`}
            </div>
          ) : (
            filteredConversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 active:bg-slate-100 transition ${
                  selected === c.id ? "bg-slate-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900 truncate flex items-center gap-1.5">
                      <span className="truncate">{c.contactName ?? "+" + c.contactPhone}</span>
                      {c.status === "closed" && (
                        <span className="shrink-0 text-[9px] font-bold text-slate-400 uppercase tracking-wide bg-slate-100 px-1 rounded">
                          closed
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 truncate">+{c.contactPhone}</div>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="inline-block bg-wa-green text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center shrink-0">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                {c.assignedToName && (
                  <div className="text-xs text-slate-400 mt-1 truncate">→ {c.assignedToName}</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div
        className={`
          flex-1 flex-col bg-slate-50
          ${selected ? "flex" : "hidden lg:flex"}
        `}
      >
        {current ? (
          <>
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
              <button
                onClick={() => setSelected(null)}
                aria-label="Back to conversations"
                className="lg:hidden -ml-1 p-1.5 rounded-lg hover:bg-slate-100 active:bg-slate-200"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
                  <span className="truncate">{current.contactName ?? "+" + current.contactPhone}</span>
                  {isClosed && (
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide bg-slate-200 px-1.5 py-0.5 rounded">
                      closed
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 truncate flex items-center gap-2">
                  <span>+{current.contactPhone}</span>
                  {current.assignedToName && (
                    <span className="text-slate-400">· assigned to {current.assignedToName}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 relative">
                {currentUser.role === "admin" && (
                  <>
                    <button
                      onClick={() => setShowReassign((v) => !v)}
                      className="px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md font-medium"
                      title="Reassign conversation"
                    >
                      Reassign
                    </button>
                    {showReassign && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 w-56 max-h-72 overflow-y-auto">
                        <button
                          onClick={() => {
                            setShowReassign(false);
                            patchConversation({ assignedToUserId: null }, "Unassigned");
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-600 italic border-b border-slate-100"
                        >
                          Unassign
                        </button>
                        {assignableUsers.map((u) => (
                          <button
                            key={u.id}
                            onClick={() => {
                              setShowReassign(false);
                              patchConversation({ assignedToUserId: u.id }, `Assigned to ${u.name}`);
                            }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                              current.assignedToUserId === u.id ? "bg-wa-green/10 text-wa-dark font-medium" : "text-slate-700"
                            }`}
                          >
                            <div className="truncate">{u.name}</div>
                            <div className="text-[10px] text-slate-400 uppercase">{u.role}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <button
                  onClick={() =>
                    patchConversation(
                      { status: isClosed ? "open" : "closed" },
                      isClosed ? "Conversation reopened" : "Conversation closed"
                    )
                  }
                  className="px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md font-medium"
                >
                  {isClosed ? "Reopen" : "Close"}
                </button>
              </div>
            </div>

            <div ref={threadRef} className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-md rounded-2xl px-3 sm:px-4 py-2 shadow-sm ${
                      m.direction === "outbound" ? "bg-wa-light" : "bg-white border border-slate-200"
                    }`}
                  >
                    <div className="text-sm text-slate-900 whitespace-pre-wrap break-words">{m.body}</div>
                    <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                      <span>{new Date(m.createdAt).toLocaleString()}</span>
                      {m.direction === "outbound" && (
                        <span className="uppercase tracking-wide">{m.status}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-12">No messages yet.</div>
              )}
            </div>

            {!withinWindow && (
              <div className="px-4 sm:px-6 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 shrink-0">
                ⚠ 24-hour window expired. Use a template instead.
              </div>
            )}

            <form onSubmit={send} className="border-t border-slate-200 bg-white p-3 sm:p-4 shrink-0">
              <div className="flex gap-2">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={
                    isClosed
                      ? "Reopen to reply"
                      : withinWindow
                      ? "Type a reply…"
                      : "24h window closed"
                  }
                  disabled={!withinWindow || sending || isClosed}
                  className="flex-1 min-w-0 px-3 sm:px-4 py-2.5 rounded-lg border border-slate-300 focus:border-wa-green focus:ring-2 focus:ring-wa-green/20 outline-none disabled:bg-slate-50 disabled:text-slate-400 text-base sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={!withinWindow || sending || !reply.trim() || isClosed}
                  className="bg-wa-green hover:bg-wa-green/90 disabled:opacity-40 text-white font-medium px-4 sm:px-5 py-2.5 rounded-lg transition shrink-0"
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm p-8 text-center">
            Select a conversation to view messages
          </div>
        )}
      </div>
    </div>
  );
}
