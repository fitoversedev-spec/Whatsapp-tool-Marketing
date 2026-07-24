"use client";

// Single-page chronological view of everything that happened with a contact.
// Merges 5 streams (messages, notes, reminders, stage changes, broadcasts
// received) into one date-sorted feed; right rail shows the contact card.

import { useMemo } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import TagPicker from "@/components/TagPicker";
import { TAG_COLOR_CLASSES } from "@/lib/tags";

type Tag = { id: string; name: string; color: string };

type MessageEvent = {
  id: string;
  kind: "message";
  direction: string;
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  status: string;
  at: string;
};
type NoteEvent = {
  id: string;
  kind: "note";
  body: string;
  authorName: string;
  at: string;
};
type ReminderEvent = {
  id: string;
  kind: "reminder";
  message: string;
  ownerName: string;
  completedAt: string | null;
  dueAt: string;
  at: string;
};
type StageEvent = {
  id: string;
  kind: "stage";
  fromStage: string | null;
  toStage: string;
  changedByName: string;
  at: string;
};
type BroadcastEvent = {
  id: string;
  kind: "broadcast";
  broadcastName: string;
  templateName: string;
  status: string;
  at: string;
};

type Event = MessageEvent | NoteEvent | ReminderEvent | StageEvent | BroadcastEvent;

export default function ContactTimelineClient({
  contact,
  conversation,
  messages,
  notes,
  reminders,
  stageHistory,
  broadcastsReceived,
}: {
  contact: {
    id: string;
    phone: string;
    name: string | null;
    allowCampaign: boolean;
    fields: Record<string, string>;
    createdAt: string;
    tagIds: string[];
    tags: Tag[];
  };
  conversation: {
    id: string;
    pipelineStage: string | null;
    dealValue: string | null;
    assignedToName: string | null;
  } | null;
  messages: MessageEvent[];
  notes: NoteEvent[];
  reminders: ReminderEvent[];
  stageHistory: StageEvent[];
  broadcastsReceived: BroadcastEvent[];
}) {
  const feed: Event[] = useMemo(() => {
    return [...messages, ...notes, ...reminders, ...stageHistory, ...broadcastsReceived].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
    );
  }, [messages, notes, reminders, stageHistory, broadcastsReceived]);

  async function saveTags(ids: string[]) {
    await fetch(`/api/contacts/${contact.id}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds: ids }),
    });
  }

  return (
    <>
      <PageHeader
        title={contact.name ?? "+" + contact.phone}
        description={contact.name ? `+${contact.phone}` : "No name on file"}
        backHref="/contacts"
        action={
          conversation && (
            <Link
              href={`/inbox?conversation=${conversation.id}`}
              className="inline-block px-3 py-1.5 text-sm bg-wa-green text-white rounded-md hover:bg-wa-dark"
            >
              Open chat →
            </Link>
          )
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline (main column) */}
        <section className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Activity</h2>
          {feed.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              No activity yet for this contact.
            </div>
          ) : (
            <ol className="relative border-l border-slate-200 ml-3 space-y-4">
              {feed.map((e) => (
                <li key={`${e.kind}-${e.id}`} className="pl-6 relative">
                  <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full ring-2 ring-white"
                    style={{ background: dotColor(e) }}
                  />
                  <EventCard event={e} />
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Right rail */}
        <aside className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Contact
            </h3>
            <Field label="Phone" value={`+${contact.phone}`} mono />
            {contact.name && <Field label="Name" value={contact.name} />}
            <Field
              label="Campaigns"
              value={contact.allowCampaign ? "Allowed" : "Blocked"}
            />
            <Field
              label="Added"
              value={new Date(contact.createdAt).toLocaleDateString("en-IN")}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Tags
            </h3>
            <TagPicker
              selectedIds={contact.tagIds}
              onChange={saveTags}
              canCreate
              size="sm"
            />
          </div>

          {conversation && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Pipeline
              </h3>
              <Field
                label="Stage"
                value={conversation.pipelineStage ?? "—"}
              />
              {conversation.dealValue && (
                <Field
                  label="Deal value"
                  value={`₹${Number(conversation.dealValue).toLocaleString("en-IN")}`}
                />
              )}
              {conversation.assignedToName && (
                <Field label="Assigned" value={conversation.assignedToName} />
              )}
            </div>
          )}

          {Object.keys(contact.fields).length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Custom fields
              </h3>
              {Object.entries(contact.fields).map(([k, v]) => (
                <Field key={k} label={k} value={v || "—"} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 mb-2 last:mb-0">
      <span className="text-xs text-slate-500 w-20 shrink-0 capitalize">{label}</span>
      <span className={`text-sm text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function EventCard({ event }: { event: Event }) {
  const when = new Date(event.at).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  if (event.kind === "message") {
    const isIn = event.direction === "inbound";
    return (
      <div className={`rounded-xl border p-3 ${isIn ? "bg-white border-slate-200" : "bg-wa-light/40 border-wa-light"}`}>
        <div className="text-xs text-slate-500 mb-1 flex items-center gap-2">
          <span>{isIn ? "← inbound" : "→ outbound"}</span>
          <span>·</span>
          <span>{when}</span>
          {event.status !== "queued" && (
            <span className="text-[10px] uppercase tracking-wide text-slate-400">
              · {event.status}
            </span>
          )}
        </div>
        {event.body && (
          <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
            {event.body}
          </div>
        )}
        {event.mediaUrl && (
          <div className="text-xs text-wa-dark mt-1">📎 {event.mediaFileName ?? "media attached"}</div>
        )}
      </div>
    );
  }

  if (event.kind === "note") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="text-xs text-amber-700 mb-1">📝 Note · {event.authorName} · {when}</div>
        <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{event.body}</div>
      </div>
    );
  }

  if (event.kind === "reminder") {
    const done = !!event.completedAt;
    return (
      <div className={`rounded-xl border p-3 ${done ? "bg-slate-50 border-slate-200 opacity-70" : "bg-orange-50 border-orange-200"}`}>
        <div className="text-xs text-orange-700 mb-1">
          ⏰ Reminder · {event.ownerName} · due {when}
          {done && <span className="ml-1 text-slate-400">· completed</span>}
        </div>
        <div className={`text-sm ${done ? "text-slate-400" : "text-slate-800"}`}>
          {event.message}
        </div>
      </div>
    );
  }

  if (event.kind === "stage") {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-slate-800">
        <div className="text-xs text-blue-700 mb-0.5">🎯 Pipeline · {event.changedByName} · {when}</div>
        Moved from <strong>{event.fromStage ?? "(none)"}</strong> → <strong>{event.toStage}</strong>
      </div>
    );
  }

  // broadcast
  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-sm text-slate-800">
      <div className="text-xs text-purple-700 mb-0.5">
        📣 Broadcast · {event.status} · {when}
      </div>
      Received <strong>{event.broadcastName}</strong>{" "}
      <span className="text-slate-500">({event.templateName})</span>
    </div>
  );
}

function dotColor(e: Event): string {
  switch (e.kind) {
    case "message":
      return e.direction === "inbound" ? "#94a3b8" : "#25D366";
    case "note":
      return "#f59e0b";
    case "reminder":
      return "#f97316";
    case "stage":
      return "#3b82f6";
    case "broadcast":
      return "#8b5cf6";
  }
}
