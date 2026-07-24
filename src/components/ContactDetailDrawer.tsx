"use client";

// Right-side slide-out drawer showing a contact's complete profile.
// Launched from the Pipeline page when a card is clicked (drag still
// moves between stages). Reusable — any page can pass a conversationId
// and the drawer fetches everything it needs from /api/conversations/[id]/profile.
//
// Sections (top → bottom):
//   1. Header: name + phone + action buttons (Open Chat, New Quote)
//   2. Pipeline stats: stage, days, deal value, assigned to
//   3. Tags (editable)
//   4. Notes (last 10 + add new)
//   5. Quotations (all sent + create new)
//   6. Reminders (active + set new)
//   7. Recent activity (mixed feed: messages + stage changes + broadcasts)

import { useEffect, useState } from "react";
import Link from "next/link";
import { TAG_COLOR_CLASSES } from "@/lib/tags";
import TagPicker from "@/components/TagPicker";

type Profile = {
  contact: {
    id: string | null;
    name: string | null;
    phone: string;
    allowCampaign: boolean;
    fields: Record<string, string>;
    tags: { id: string; name: string; color: string }[];
    tagIds: string[];
  };
  conversation: {
    id: string;
    status: string;
    pipelineStage: string | null;
    dealValue: string | null;
    expectedCloseAt: string | null;
    stageChangedAt: string | null;
    daysInStage: number | null;
    assignedTo: { id: string; name: string } | null;
    labels: { id: string; name: string; color: string }[];
  };
  notes: {
    id: string;
    body: string;
    pinned: boolean;
    authorName: string;
    createdAt: string;
    editedAt: string | null;
  }[];
  quotations: {
    id: string;
    number: string;
    grandTotal: string;
    status: string;
    pdfUrl: string | null;
    quoteDate: string;
    sentAt: string | null;
    createdByName: string;
    createdAt: string;
  }[];
  reminders: {
    id: string;
    message: string;
    dueAt: string;
    completedAt: string | null;
    ownerName: string;
  }[];
  activity: (
    | {
        kind: "message";
        id: string;
        at: string;
        direction: string;
        preview: string;
        status: string;
      }
    | {
        kind: "stage";
        id: string;
        at: string;
        fromStage: string | null;
        toStage: string;
        changedBy: string;
      }
    | {
        kind: "broadcast";
        id: string;
        at: string;
        name: string;
        templateName: string;
        status: string;
      }
  )[];
};

const QUOTE_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-purple-100 text-purple-800",
  accepted: "bg-emerald-100 text-emerald-800",
  expired: "bg-red-100 text-red-800",
};

export default function ContactDetailDrawer({
  conversationId,
  open,
  onClose,
  onAction,
}: {
  conversationId: string | null;
  open: boolean;
  onClose: () => void;
  // Called after a change that the parent page should reflect (stage move,
  // tag update, etc.) so it can refresh its own data.
  onAction?: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNewNote, setShowNewNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (!open || !conversationId) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/conversations/${conversationId}/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Profile | null) => {
        if (!cancelled) setProfile(data);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function saveTags(ids: string[]) {
    if (!profile?.contact.id) return;
    await fetch(`/api/contacts/${profile.contact.id}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds: ids }),
    });
    // Optimistically update local view (parent refresh handles persistence
    // checks via onAction)
    setProfile((p) =>
      p
        ? {
            ...p,
            contact: {
              ...p.contact,
              tagIds: ids,
            },
          }
        : p
    );
    onAction?.();
  }

  async function addNote() {
    if (!noteDraft.trim() || !conversationId || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteDraft.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setProfile((p) =>
          p ? { ...p, notes: [data.note, ...p.notes] } : p
        );
        setNoteDraft("");
        setShowNewNote(false);
        onAction?.();
      }
    } finally {
      setSavingNote(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[600px] bg-white shadow-2xl flex flex-col"
        style={{ maxWidth: "100vw" }}
      >
        {loading || !profile ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
            Loading…
          </div>
        ) : (
          <>
            {/* HEADER */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-slate-900 truncate">
                  {profile.contact.name || "+" + profile.contact.phone}
                </h2>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  +{profile.contact.phone}
                </div>
                {profile.conversation.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {profile.conversation.labels.map((l) => {
                      const c = TAG_COLOR_CLASSES[l.color] ?? TAG_COLOR_CLASSES.slate;
                      return (
                        <span
                          key={l.id}
                          className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${c.bg} ${c.text}`}
                        >
                          {l.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Close drawer"
                className="p-1.5 rounded-md hover:bg-slate-100 shrink-0"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* PRIMARY ACTION BUTTONS */}
            <div className="px-5 py-3 border-b border-slate-200 flex gap-2 bg-slate-50">
              <Link
                href={`/inbox?conversation=${profile.conversation.id}`}
                className="flex-1 px-3 py-2 text-sm font-medium bg-wa-green hover:bg-wa-green/90 text-white text-center rounded-md transition"
              >
                ↗ Open Chat
              </Link>
              <Link
                href={`/quotations?conversationId=${profile.conversation.id}&contactPhone=${profile.contact.phone}&customerName=${encodeURIComponent(profile.contact.name ?? "")}`}
                className="flex-1 px-3 py-2 text-sm font-medium bg-white border border-slate-300 hover:border-slate-400 text-slate-700 text-center rounded-md transition"
              >
                📄 New Quote
              </Link>
            </div>

            {/* SCROLLABLE CONTENT */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* PIPELINE STATS */}
              <Section title="📊 Pipeline" muted>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Stage" value={profile.conversation.pipelineStage ?? "—"} />
                  <Stat
                    label="Days in stage"
                    value={
                      profile.conversation.daysInStage !== null
                        ? `${profile.conversation.daysInStage} days`
                        : "—"
                    }
                    tone={daysToneClass(profile.conversation.daysInStage)}
                  />
                  <Stat
                    label="Deal value"
                    value={
                      profile.conversation.dealValue
                        ? `₹ ${Number(profile.conversation.dealValue).toLocaleString("en-IN")}`
                        : "—"
                    }
                  />
                  <Stat
                    label="Expected close"
                    value={
                      profile.conversation.expectedCloseAt
                        ? new Date(profile.conversation.expectedCloseAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "2-digit",
                          })
                        : "—"
                    }
                  />
                  <Stat
                    label="Assigned to"
                    value={profile.conversation.assignedTo?.name ?? "Unassigned"}
                    wide
                  />
                </div>
              </Section>

              {/* TAGS */}
              {profile.contact.id && (
                <Section title="🏷️ Tags">
                  <TagPicker
                    selectedIds={profile.contact.tagIds}
                    onChange={saveTags}
                    canCreate
                    size="md"
                  />
                </Section>
              )}

              {/* NOTES */}
              <Section
                title={`📝 Notes (${profile.notes.length})`}
                action={
                  <button
                    onClick={() => setShowNewNote((v) => !v)}
                    className="text-xs text-wa-dark hover:underline"
                  >
                    {showNewNote ? "Cancel" : "+ Add note"}
                  </button>
                }
              >
                {showNewNote && (
                  <div className="mb-2 space-y-2 bg-amber-50 border border-amber-200 rounded-md p-2">
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Add a note about this customer…"
                      rows={3}
                      autoFocus
                      className="w-full px-2 py-1.5 text-sm border border-amber-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-500/30 bg-white resize-none"
                    />
                    <button
                      onClick={addNote}
                      disabled={!noteDraft.trim() || savingNote}
                      className="px-3 py-1.5 text-xs font-medium bg-wa-green text-white rounded disabled:opacity-50"
                    >
                      {savingNote ? "Saving…" : "Save note"}
                    </button>
                  </div>
                )}
                {profile.notes.length === 0 ? (
                  <EmptyHint>No notes yet</EmptyHint>
                ) : (
                  <ul className="space-y-2">
                    {profile.notes.map((n) => (
                      <li
                        key={n.id}
                        className={`rounded-md border p-2.5 ${
                          n.pinned
                            ? "border-amber-300 bg-amber-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
                          {n.body}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1.5">
                          {n.pinned && <span>📌</span>}
                          <span className="font-medium">{n.authorName}</span>
                          <span>·</span>
                          <span>{relativeTime(n.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* QUOTATIONS */}
              <Section
                title={`📄 Quotations (${profile.quotations.length})`}
                action={
                  <Link
                    href={`/quotations?conversationId=${profile.conversation.id}&contactPhone=${profile.contact.phone}&customerName=${encodeURIComponent(profile.contact.name ?? "")}`}
                    className="text-xs text-wa-dark hover:underline"
                  >
                    + New quote
                  </Link>
                }
              >
                {profile.quotations.length === 0 ? (
                  <EmptyHint>No quotations sent yet</EmptyHint>
                ) : (
                  <ul className="space-y-2">
                    {profile.quotations.map((q) => (
                      <li
                        key={q.id}
                        className="border border-slate-200 rounded-md p-2.5 bg-white"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-mono font-semibold text-slate-900">
                                {q.number}
                              </span>
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                                  QUOTE_STATUS_COLORS[q.status] ?? "bg-slate-100"
                                }`}
                              >
                                {q.status}
                              </span>
                            </div>
                            <div className="text-sm font-bold text-slate-900 mt-0.5">
                              ₹ {Number(q.grandTotal).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {q.createdByName} · {relativeTime(q.createdAt)}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <a
                              href={`/api/quotations/${q.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-wa-dark hover:underline whitespace-nowrap"
                            >
                              View PDF
                            </a>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* REMINDERS */}
              <Section
                title={`⏰ Reminders (${profile.reminders.filter((r) => !r.completedAt).length} active)`}
              >
                {profile.reminders.length === 0 ? (
                  <EmptyHint>No reminders yet</EmptyHint>
                ) : (
                  <ul className="space-y-2">
                    {profile.reminders.map((r) => {
                      const due = new Date(r.dueAt);
                      const overdue = !r.completedAt && due < new Date();
                      return (
                        <li
                          key={r.id}
                          className={`border rounded-md p-2.5 ${
                            r.completedAt
                              ? "border-slate-200 bg-slate-50 opacity-60"
                              : overdue
                                ? "border-red-200 bg-red-50"
                                : "border-orange-200 bg-orange-50"
                          }`}
                        >
                          <div
                            className={`text-sm ${
                              r.completedAt
                                ? "text-slate-400"
                                : "text-slate-800"
                            }`}
                          >
                            {r.message}
                          </div>
                          <div
                            className={`text-[10px] mt-1 ${
                              overdue ? "text-red-700 font-medium" : "text-slate-500"
                            }`}
                          >
                            {overdue && "⚠ "}
                            {due.toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                            {" · "}
                            {r.ownerName}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              {/* RECENT ACTIVITY */}
              <Section title="📋 Recent activity">
                {profile.activity.length === 0 ? (
                  <EmptyHint>No activity yet</EmptyHint>
                ) : (
                  <ol className="relative border-l border-slate-200 ml-2 space-y-2.5">
                    {profile.activity.map((e) => (
                      <li key={`${e.kind}-${e.id}`} className="pl-4 relative">
                        <span
                          className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ring-2 ring-white"
                          style={{ background: dotColor(e.kind) }}
                        />
                        <ActivityRow event={e} />
                      </li>
                    ))}
                  </ol>
                )}
                {profile.contact.id && (
                  <div className="mt-3 text-center">
                    <Link
                      href={`/contacts/${profile.contact.id}`}
                      className="text-xs text-wa-dark hover:underline"
                    >
                      Open full profile →
                    </Link>
                  </div>
                )}
              </Section>

              {/* CUSTOM FIELDS */}
              {Object.keys(profile.contact.fields).length > 0 && (
                <Section title="📁 Custom fields">
                  <dl className="space-y-1.5 text-sm">
                    {Object.entries(profile.contact.fields).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <dt className="text-slate-500 capitalize">{k}</dt>
                        <dd className="text-slate-900 text-right">{v || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Section({
  title,
  action,
  children,
  muted = false,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <section className={muted ? "bg-slate-50 border border-slate-200 rounded-lg p-3" : ""}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  wide = false,
  tone = "",
}: {
  label: string;
  value: string;
  wide?: boolean;
  tone?: string;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${tone || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center text-xs text-slate-400 py-3">{children}</div>
  );
}

function ActivityRow({ event }: { event: Profile["activity"][number] }) {
  const when = relativeTime(event.at);
  if (event.kind === "message") {
    return (
      <div className="text-xs">
        <span className="text-slate-500">
          {event.direction === "inbound" ? "← Inbound" : "→ Outbound"} · {when}
        </span>
        <div className="text-slate-800 truncate mt-0.5">{event.preview}</div>
      </div>
    );
  }
  if (event.kind === "stage") {
    return (
      <div className="text-xs">
        <span className="text-blue-700">🎯 Stage moved</span>
        <span className="text-slate-500"> · {event.changedBy} · {when}</span>
        <div className="text-slate-800 mt-0.5">
          <strong>{event.fromStage ?? "(none)"}</strong> →{" "}
          <strong>{event.toStage}</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs">
      <span className="text-purple-700">📣 Broadcast received · {when}</span>
      <div className="text-slate-800 mt-0.5">
        {event.name} <span className="text-slate-500">({event.templateName})</span>
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function daysToneClass(days: number | null): string {
  if (days === null) return "text-slate-900";
  if (days < 7) return "text-emerald-700";
  if (days < 30) return "text-amber-700";
  return "text-red-700 font-semibold";
}

function dotColor(kind: "message" | "stage" | "broadcast"): string {
  if (kind === "message") return "#94a3b8";
  if (kind === "stage") return "#3b82f6";
  return "#8b5cf6";
}
