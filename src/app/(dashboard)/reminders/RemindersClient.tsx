"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";

type TimeBucket = "overdue" | "today" | "week" | "later" | "completed";

type Reminder = {
  id: string;
  conversationId: string | null;
  contactPhone: string | null;
  contactName: string | null;
  message: string;
  dueAt: string;
  completedAt: string | null;
  createdAt: string;
  section: string;
  sectionLink: string | null;
  sectionEntityName: string | null;
  timeBucket: TimeBucket;
};

const SECTION_ICONS: Record<string, string> = {
  "Meta Leads": "📣",
  "CRM Deals": "💼",
  "CRM Contacts": "👤",
  "WhatsApp Inbox": "💬",
  General: "📌",
};

const BUCKET_STYLE: Record<
  TimeBucket,
  { label: string; dot: string; text: string }
> = {
  overdue: { label: "Overdue", dot: "bg-red-500", text: "text-red-600" },
  today: { label: "Today", dot: "bg-amber-500", text: "text-amber-600" },
  week: { label: "This week", dot: "bg-blue-500", text: "text-blue-600" },
  later: { label: "Later", dot: "bg-slate-400", text: "text-slate-500" },
  completed: {
    label: "Done",
    dot: "bg-emerald-500",
    text: "text-emerald-600",
  },
};

export default function RemindersClient({
  reminders,
  dateFilter,
}: {
  reminders: Reminder[];
  dateFilter: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [localDate, setLocalDate] = useState(dateFilter ?? "");

  const sections = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of reminders) {
      const list = map.get(r.section) ?? [];
      list.push(r);
      map.set(r.section, list);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, items]) => ({ name, items }));
  }, [reminders]);

  const totalActive = reminders.filter((r) => !r.completedAt).length;
  const totalCompleted = reminders.filter((r) => r.completedAt).length;

  async function action(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      await fetch(`/api/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this reminder?")) return;
    setBusy(id);
    try {
      await fetch(`/api/reminders/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function applyDate(date: string) {
    setLocalDate(date);
    if (date) {
      router.push(`/reminders?date=${date}`);
    } else {
      router.push("/reminders");
    }
  }

  return (
    <>
      <PageHeader
        title="Reminders"
        description={
          dateFilter
            ? `Showing reminders for ${new Date(dateFilter + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`
            : `${totalActive} active · ${totalCompleted} recently completed`
        }
        action={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={localDate}
              onChange={(e) => applyDate(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-court-400"
            />
            {dateFilter && (
              <button
                onClick={() => applyDate("")}
                className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1.5 rounded-lg hover:bg-slate-100"
              >
                Clear
              </button>
            )}
          </div>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {reminders.length === 0 && (
          <div className="card p-10 text-center">
            <div className="text-4xl mb-2">
              {dateFilter ? "📅" : "🎉"}
            </div>
            <h3 className="font-semibold text-slate-900">
              {dateFilter ? "No reminders on this date" : "All caught up"}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {dateFilter
                ? "Try picking a different date or clear the filter to see all."
                : "Set follow-up reminders from any conversation in the Inbox."}
            </p>
            {!dateFilter && (
              <Link href="/inbox" className="btn btn-primary mt-4">
                Go to Inbox
              </Link>
            )}
          </div>
        )}

        {sections.map(({ name, items }) => {
          const activeItems = items.filter((r) => !r.completedAt);
          const completedItems = items.filter((r) => r.completedAt);
          return (
            <section key={name} className="card overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50 border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <span>{SECTION_ICONS[name] ?? "📋"}</span>
                  {name}
                </h2>
                <span className="text-xs font-medium font-mono text-slate-500">
                  {items.length}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {activeItems.map((r) => (
                  <Row
                    key={r.id}
                    reminder={r}
                    busy={busy === r.id}
                    action={action}
                    remove={remove}
                  />
                ))}
                {completedItems.length > 0 && activeItems.length > 0 && (
                  <li className="px-5 py-1.5 bg-slate-50">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Completed
                    </span>
                  </li>
                )}
                {completedItems.map((r) => (
                  <Row
                    key={r.id}
                    reminder={r}
                    busy={busy === r.id}
                    action={action}
                    remove={remove}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Row({
  reminder,
  busy,
  action,
  remove,
}: {
  reminder: Reminder;
  busy: boolean;
  action: (id: string, body: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  const due = new Date(reminder.dueAt);
  const isCompleted = !!reminder.completedAt;
  const bucket = BUCKET_STYLE[reminder.timeBucket];

  return (
    <li
      className={`px-5 py-3 flex items-center gap-4 ${isCompleted ? "opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={isCompleted}
        disabled={busy}
        onChange={() => action(reminder.id, { completed: !isCompleted })}
        className="rounded"
      />
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm ${isCompleted ? "text-slate-400" : "text-slate-900 font-medium"}`}
        >
          {reminder.message}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 ${bucket.text} font-medium`}
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${bucket.dot}`}
            />
            {bucket.label}
          </span>
          <span className="text-slate-300">·</span>
          <span className="font-mono">
            {due.toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {reminder.sectionEntityName && (
            <>
              <span className="text-slate-300">·</span>
              {reminder.sectionLink ? (
                <Link
                  href={reminder.sectionLink}
                  className="text-court-600 hover:underline truncate max-w-[200px]"
                >
                  {reminder.sectionEntityName}
                </Link>
              ) : (
                <span className="truncate max-w-[200px]">
                  {reminder.sectionEntityName}
                </span>
              )}
            </>
          )}
          {!reminder.sectionEntityName && reminder.conversationId && (
            <>
              <span className="text-slate-300">·</span>
              <Link
                href={`/inbox?conversation=${reminder.conversationId}`}
                className="text-court-600 hover:underline"
              >
                {reminder.contactName ??
                  "+" + (reminder.contactPhone ?? "")}
              </Link>
            </>
          )}
        </div>
      </div>
      {!isCompleted && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            disabled={busy}
            onClick={() => {
              const newDue = new Date(Date.now() + 60 * 60 * 1000);
              action(reminder.id, { dueAt: newDue.toISOString() });
            }}
            className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 hover:bg-slate-100 rounded"
          >
            +1h
          </button>
          <button
            disabled={busy}
            onClick={() => {
              const newDue = new Date(Date.now() + 24 * 60 * 60 * 1000);
              action(reminder.id, { dueAt: newDue.toISOString() });
            }}
            className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 hover:bg-slate-100 rounded"
          >
            +1d
          </button>
          <button
            disabled={busy}
            onClick={() => remove(reminder.id)}
            className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
