"use client";

import { useState, useEffect, useRef, useMemo, FormEvent } from "react";
import { useToast } from "@/components/Toast";
import NotesPanel from "./NotesPanel";
import RemindersPanel from "./RemindersPanel";
import LabelPicker from "@/components/LabelPicker";
import { TAG_COLOR_CLASSES } from "@/lib/tags";
import MediaPreview from "@/components/MediaPreview";
import QuoteWizard from "@/app/(dashboard)/quotations/QuoteWizard";

type ConversationLabel = { id: string; name: string; color: string };
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
  labelIds: string[];
  labels: ConversationLabel[];
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  mediaSize?: number | null;
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
  const [showNotes, setShowNotes] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
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

  // Load messages when selection changes + poll every 8s while open so
  // inbound replies stream in without the user having to re-click the thread.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const load = async () => {
      const r = await fetch(`/api/conversations/${selected}/messages`);
      if (!r.ok || cancelled) return;
      const data = await r.json();
      if (cancelled) return;
      setMessages((prev) => {
        // Avoid pointless re-render (and scroll jump) when the message list
        // is unchanged. Cheap shallow check on last id + length.
        const next: Message[] = data.messages ?? [];
        if (
          prev.length === next.length &&
          prev[prev.length - 1]?.id === next[next.length - 1]?.id
        ) {
          return prev;
        }
        return next;
      });
      setWithinWindow(data.withinWindow ?? false);
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
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

  async function sendMedia(file: File, caption: string) {
    if (!selected) return;
    setSending(true);
    try {
      // Step 1: upload to Vercel Blob via /api/media/upload
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (!up.ok) {
        const e = await up.json().catch(() => ({}));
        toast.error(e.error ?? "Upload failed");
        return;
      }
      const { media } = await up.json();

      // Step 2: send message with mediaId
      const res = await fetch(`/api/conversations/${selected}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: media.id, caption: caption.trim() || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
        setReply("");
      } else {
        const e = await res.json().catch(() => ({}));
        if (res.status === 422) setWithinWindow(false);
        toast.error(e.error ?? "Send failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSending(false);
    }
  }

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
                {c.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {c.labels.map((l) => {
                      const col = TAG_COLOR_CLASSES[l.color] ?? TAG_COLOR_CLASSES.slate;
                      return (
                        <span
                          key={l.id}
                          className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-medium ${col.bg} ${col.text}`}
                        >
                          {l.name}
                        </span>
                      );
                    })}
                  </div>
                )}
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
                <div className="mt-1.5">
                  <LabelPicker
                    conversationId={current.id}
                    selectedIds={current.labelIds}
                    onChange={(ids) => {
                      // Optimistically update local state so labels rerender
                      // immediately; the picker also persists to the server.
                      setConversations((prev) =>
                        prev.map((c) =>
                          c.id === current.id ? { ...c, labelIds: ids } : c
                        )
                      );
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 relative">
                <button
                  onClick={() => {
                    setShowNotes((v) => !v);
                    setShowReminders(false);
                  }}
                  className={`px-2.5 py-1.5 text-xs rounded-md font-medium ${
                    showNotes ? "bg-amber-100 text-amber-800" : "text-slate-600 hover:bg-slate-100"
                  }`}
                  title="Notes"
                >
                  📝<span className="hidden sm:inline ml-1">Notes</span>
                </button>
                <button
                  onClick={() => {
                    setShowReminders((v) => !v);
                    setShowNotes(false);
                  }}
                  className={`px-2.5 py-1.5 text-xs rounded-md font-medium ${
                    showReminders ? "bg-orange-100 text-orange-800" : "text-slate-600 hover:bg-slate-100"
                  }`}
                  title="Reminders"
                >
                  ⏰<span className="hidden sm:inline ml-1">Reminders</span>
                </button>
                <button
                  onClick={() => setShowQuote(true)}
                  className="px-2.5 py-1.5 text-xs rounded-md font-medium text-slate-600 hover:bg-slate-100"
                  title="Generate Quote"
                >
                  📄<span className="hidden sm:inline ml-1">Quote</span>
                </button>
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
                    {m.mediaUrl && (
                      <div className="mb-1">
                        <MediaPreview
                          url={m.mediaUrl}
                          mimeType={m.mediaMimeType ?? null}
                          fileName={m.mediaFileName}
                          size={m.mediaSize}
                        />
                      </div>
                    )}
                    {m.body && (
                      <div className="text-sm text-slate-900 whitespace-pre-wrap break-words">{m.body}</div>
                    )}
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
                <label
                  className={`shrink-0 self-center w-10 h-10 rounded-lg border border-slate-300 flex items-center justify-center cursor-pointer transition ${
                    withinWindow && !sending && !isClosed
                      ? "hover:border-wa-green hover:bg-slate-50 text-slate-600"
                      : "opacity-40 cursor-not-allowed text-slate-400"
                  }`}
                  title="Attach file"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.49" />
                  </svg>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/*"
                    disabled={!withinWindow || sending || isClosed}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        sendMedia(f, reply);
                        // Reset input so the same file can be re-picked
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={
                    isClosed
                      ? "Reopen to reply"
                      : withinWindow
                      ? "Type a reply… (or attach a file)"
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

      {current && (
        <>
          <NotesPanel
            conversationId={current.id}
            currentUser={{ id: currentUser.id, role: currentUser.role }}
            open={showNotes}
            onClose={() => setShowNotes(false)}
          />
          <RemindersPanel
            conversationId={current.id}
            contactLabel={current.contactName ?? "+" + current.contactPhone}
            open={showReminders}
            onClose={() => setShowReminders(false)}
          />
          <QuoteWizard
            open={showQuote}
            onClose={() => setShowQuote(false)}
            onComplete={() => setShowQuote(false)}
            prefill={{
              customerName: current.contactName ?? "+" + current.contactPhone,
              contactPhone: current.contactPhone,
              conversationId: current.id,
            }}
          />
        </>
      )}
    </div>
  );
}
