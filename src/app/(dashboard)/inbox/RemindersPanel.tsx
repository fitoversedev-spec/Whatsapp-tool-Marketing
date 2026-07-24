"use client";

import { useEffect, useState } from "react";

type Reminder = {
  id: string;
  conversationId: string | null;
  message: string;
  dueAt: string;
  completedAt: string | null;
  notifiedAt: string | null;
  createdAt: string;
};

export default function RemindersPanel({
  conversationId,
  contactLabel,
  open,
  onClose,
}: {
  conversationId: string;
  contactLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/reminders?conversationId=${conversationId}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setReminders(data.reminders);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  function setPreset(hoursFromNow: number) {
    const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
    // Round to next 5-minute mark for cleaner times
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    setDueAt(toLocalInputValue(d));
  }

  async function addReminder() {
    if (!message.trim() || !dueAt || saving) return;
    setSaving(true);
    try {
      const due = new Date(dueAt);
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: message.trim(),
          dueAt: due.toISOString(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReminders((curr) => [data.reminder, ...curr]);
        setMessage("");
        setDueAt("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r: Reminder) {
    const completed = !r.completedAt;
    const res = await fetch(`/api/reminders/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    if (res.ok) {
      const data = await res.json();
      setReminders((curr) =>
        curr.map((x) => (x.id === r.id ? { ...x, ...data.reminder } : x))
      );
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this reminder?")) return;
    const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    if (res.ok) {
      setReminders((curr) => curr.filter((r) => r.id !== id));
    }
  }

  async function snooze(r: Reminder, hours: number) {
    const newDue = new Date(Date.now() + hours * 60 * 60 * 1000);
    const res = await fetch(`/api/reminders/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueAt: newDue.toISOString() }),
    });
    if (res.ok) {
      const data = await res.json();
      setReminders((curr) =>
        curr.map((x) => (x.id === r.id ? { ...x, ...data.reminder } : x))
      );
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="lg:hidden fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`
          fixed lg:relative inset-y-0 right-0 z-50 lg:z-auto
          w-full sm:w-96 lg:w-80 xl:w-96 lg:shrink-0 h-full
          bg-white border-l border-slate-200 flex flex-col
          shadow-2xl lg:shadow-none
        `}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">⏰ Reminders</h3>
            <p className="text-xs text-slate-500 truncate">{contactLabel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close reminders"
            className="p-1.5 rounded-md hover:bg-slate-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Add */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 space-y-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Follow up about pricing…"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 bg-white"
          />
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 bg-white"
          />
          <div className="flex flex-wrap gap-1.5">
            <PresetBtn onClick={() => setPreset(1)}>+1h</PresetBtn>
            <PresetBtn onClick={() => setPreset(4)}>+4h</PresetBtn>
            <PresetBtn onClick={() => setPreset(24)}>Tomorrow</PresetBtn>
            <PresetBtn onClick={() => setPreset(72)}>+3d</PresetBtn>
            <PresetBtn onClick={() => setPreset(168)}>+1w</PresetBtn>
          </div>
          <button
            onClick={addReminder}
            disabled={!message.trim() || !dueAt || saving}
            className="w-full px-3 py-2 text-xs font-medium bg-orange-500 text-white rounded-md disabled:opacity-40 hover:bg-orange-600 transition"
          >
            {saving ? "Setting…" : "Set reminder"}
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center text-xs text-slate-500 py-8">Loading…</div>
          ) : reminders.length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-8">
              No reminders yet for this contact.
            </div>
          ) : (
            reminders.map((r) => {
              const due = new Date(r.dueAt);
              const overdue = !r.completedAt && due < new Date();
              return (
                <div
                  key={r.id}
                  className={`rounded-lg border p-3 ${
                    r.completedAt
                      ? "bg-slate-50 border-slate-200 opacity-60"
                      : overdue
                        ? "bg-red-50 border-red-200"
                        : "bg-white border-slate-200"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={!!r.completedAt}
                      onChange={() => toggle(r)}
                      className="mt-1 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm whitespace-pre-wrap break-words ${
                          r.completedAt ? "text-slate-400" : "text-slate-800"
                        }`}
                      >
                        {r.message}
                      </div>
                      <div className={`text-xs mt-1 ${overdue ? "text-red-700 font-medium" : "text-slate-500"}`}>
                        {overdue && "⚠ "}
                        {due.toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                      {!r.completedAt && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          <button
                            onClick={() => snooze(r, 1)}
                            className="text-[10px] text-slate-600 hover:text-slate-900 underline"
                          >
                            +1h
                          </button>
                          <button
                            onClick={() => snooze(r, 24)}
                            className="text-[10px] text-slate-600 hover:text-slate-900 underline"
                          >
                            +1d
                          </button>
                          <button
                            onClick={() => remove(r.id)}
                            className="text-[10px] text-red-600 hover:underline ml-auto"
                          >
                            delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}

function PresetBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="text-[10px] px-2 py-1 bg-white border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
