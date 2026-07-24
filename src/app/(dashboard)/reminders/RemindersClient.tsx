"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";

type Reminder = {
  id: string;
  conversationId: string | null;
  contactPhone: string | null;
  contactName: string | null;
  message: string;
  dueAt: string;
  completedAt: string | null;
  createdAt: string;
};

export default function RemindersClient({
  overdue,
  today,
  week,
  later,
  completed,
}: {
  overdue: Reminder[];
  today: Reminder[];
  week: Reminder[];
  later: Reminder[];
  completed: Reminder[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

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

  const totalActive = overdue.length + today.length + week.length + later.length;

  return (
    <>
      <PageHeader
        title="Reminders"
        description={`${totalActive} active · ${completed.length} recently completed`}
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {totalActive === 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <div className="text-4xl mb-2">🎉</div>
            <h3 className="font-semibold text-slate-900">All caught up</h3>
            <p className="text-sm text-slate-500 mt-1">
              Set follow-up reminders from any conversation in the Inbox.
            </p>
            <Link
              href="/inbox"
              className="inline-block mt-4 px-4 py-2 text-sm bg-wa-green text-white rounded-md hover:bg-wa-dark"
            >
              Go to Inbox
            </Link>
          </div>
        )}

        {overdue.length > 0 && (
          <Section title="🚨 Overdue" count={overdue.length} tone="red">
            {overdue.map((r) => (
              <Row key={r.id} reminder={r} busy={busy === r.id} action={action} remove={remove} />
            ))}
          </Section>
        )}

        {today.length > 0 && (
          <Section title="📅 Today" count={today.length} tone="amber">
            {today.map((r) => (
              <Row key={r.id} reminder={r} busy={busy === r.id} action={action} remove={remove} />
            ))}
          </Section>
        )}

        {week.length > 0 && (
          <Section title="📆 This week" count={week.length} tone="blue">
            {week.map((r) => (
              <Row key={r.id} reminder={r} busy={busy === r.id} action={action} remove={remove} />
            ))}
          </Section>
        )}

        {later.length > 0 && (
          <Section title="🗂️ Later" count={later.length} tone="slate">
            {later.map((r) => (
              <Row key={r.id} reminder={r} busy={busy === r.id} action={action} remove={remove} />
            ))}
          </Section>
        )}

        {completed.length > 0 && (
          <Section title="✅ Recently completed" count={completed.length} tone="emerald">
            {completed.map((r) => (
              <Row key={r.id} reminder={r} busy={busy === r.id} action={action} remove={remove} />
            ))}
          </Section>
        )}
      </div>
    </>
  );
}

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: "red" | "amber" | "blue" | "slate" | "emerald";
  children: React.ReactNode;
}) {
  const headBg = {
    red: "bg-red-50 border-red-200 text-red-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
  }[tone];
  return (
    <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className={`px-5 py-3 border-b ${headBg} flex items-center justify-between`}>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs font-medium">{count}</span>
      </div>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
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
  return (
    <li className={`px-5 py-3 flex items-center gap-4 ${isCompleted ? "opacity-60" : ""}`}>
      <input
        type="checkbox"
        checked={isCompleted}
        disabled={busy}
        onChange={() => action(reminder.id, { completed: !isCompleted })}
        className="rounded"
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${isCompleted ? "text-slate-400" : "text-slate-900 font-medium"}`}>
          {reminder.message}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>
            {due.toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {reminder.conversationId && (
            <>
              <span>·</span>
              <Link
                href={`/inbox?conversation=${reminder.conversationId}`}
                className="text-wa-dark hover:underline"
              >
                {reminder.contactName ?? "+" + (reminder.contactPhone ?? "")}
              </Link>
            </>
          )}
        </div>
      </div>
      {!isCompleted && (
        <div className="flex items-center gap-1">
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
