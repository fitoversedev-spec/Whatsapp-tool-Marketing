"use client";

// A contact's Next actions — any number, no deal needed. A dated one also
// reminds the rep handling the customer (the API keeps that reminder in step).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export type NextActionRow = {
  id: string;
  text: string;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
  createdByName: string;
  doneByName: string | null;
};

function fmtDue(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

function isOverdue(a: NextActionRow): boolean {
  return !a.doneAt && !!a.dueAt && new Date(a.dueAt).getTime() < Date.now();
}

// Local (browser) date/time parts for the date + time inputs.
function localParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "09:00" };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

// Open ones first — dated by due date (so overdue sits on top), then undated
// in the order they were added.
export function openNextActions(actions: NextActionRow[]): NextActionRow[] {
  return actions
    .filter((a) => !a.doneAt)
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

// The prominent strip at the top of the contact page: the most pressing open
// next action, with a way into the full list.
export function NextActionStrip({ actions, canEdit, onAdd }: { actions: NextActionRow[]; canEdit: boolean; onAdd: () => void }) {
  const open = openNextActions(actions);
  const first = open[0];
  return (
    // Solid bg-amber-50 (not /60): globals.css only re-tints that exact class
    // for dark mode — the opacity variant stayed light under light dark-mode text.
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Next action</div>
          {first ? (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              {first.dueAt && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded uppercase font-mono ${isOverdue(first) ? "text-red-700 bg-red-100" : "text-amber-800 bg-amber-100"}`}>
                  {isOverdue(first) ? "Overdue · " : ""}{fmtDate(first.dueAt)}
                </span>
              )}
              <span className="text-sm text-slate-800" data-guide="crm-contact-next-action">{first.text}</span>
              {open.length > 1 && (
                <a href="#next-actions" className="text-xs font-medium text-amber-800 hover:underline">+{open.length - 1} more</a>
              )}
            </div>
          ) : (
            <div className="mt-1 text-sm text-slate-400">No next action set.</div>
          )}
        </div>
        {canEdit && (
          <button onClick={onAdd} className="text-xs font-medium text-amber-800 hover:underline shrink-0">
            + Add
          </button>
        )}
      </div>
    </div>
  );
}

function NextActionForm({
  initial, saving, onCancel, onSave,
}: {
  initial: { text: string; dueAt: string | null };
  saving: boolean;
  onCancel: () => void;
  onSave: (v: { text: string; dueAt: string | null }) => void;
}) {
  const parts = localParts(initial.dueAt);
  const [text, setText] = useState(initial.text);
  const [date, setDate] = useState(parts.date);
  const [time, setTime] = useState(parts.time);

  function submit() {
    if (!text.trim()) return;
    onSave({ text: text.trim(), dueAt: date ? new Date(`${date}T${time || "09:00"}:00`).toISOString() : null });
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="What's the next step? e.g. Follow-up call, Site visit, Send revised quote…"
        className="w-full input"
      />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs font-medium text-slate-600">Due date (optional)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 input w-40" />
        </div>
        {date && (
          <div>
            <label className="text-xs font-medium text-slate-600">Time</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 input w-28" />
          </div>
        )}
        {date && (
          <button type="button" onClick={() => setDate("")} className="text-xs text-slate-500 hover:underline mb-2">
            Clear date
          </button>
        )}
      </div>
      {date && <p className="text-xs text-slate-500">The rep handling this customer gets a reminder at this time.</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={saving} className="btn btn-ghost !px-3 !py-1.5 !text-sm">Cancel</button>
        <button onClick={submit} disabled={saving || !text.trim()} className="btn btn-primary !px-3 !py-1.5 !text-sm disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function NextActionsSection({
  contactId, actions, canEdit, addSignal,
}: {
  contactId: string;
  actions: NextActionRow[];
  canEdit: boolean;
  // Bumped by the top strip's "+ Add" to open the add form here.
  addSignal: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (addSignal > 0 && canEdit) setAdding(true);
  }, [addSignal, canEdit]);

  const open = openNextActions(actions);
  const done = actions
    .filter((a) => a.doneAt)
    .sort((a, b) => new Date(b.doneAt as string).getTime() - new Date(a.doneAt as string).getTime());

  async function call(url: string, init: RequestInit, ok: string, fail: string): Promise<boolean> {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    if (res.ok) {
      toast.success(ok);
      router.refresh();
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast.error(err.error ?? fail);
    return false;
  }

  async function add(v: { text: string; dueAt: string | null }) {
    setBusyId("new");
    const ok = await call(`/api/account-contacts/${contactId}/next-actions`, { method: "POST", body: JSON.stringify(v) }, "Next action added", "Could not add next action");
    setBusyId(null);
    if (ok) setAdding(false);
  }

  async function update(id: string, patch: Record<string, unknown>, okMsg: string) {
    setBusyId(id);
    const ok = await call(`/api/account-contacts/${contactId}/next-actions/${id}`, { method: "PATCH", body: JSON.stringify(patch) }, okMsg, "Could not update next action");
    setBusyId(null);
    if (ok) setEditingId(null);
  }

  async function remove(a: NextActionRow) {
    if (!confirm(`Delete this next action?\n\n${a.text}`)) return;
    setBusyId(a.id);
    await call(`/api/account-contacts/${contactId}/next-actions/${a.id}`, { method: "DELETE" }, "Next action deleted", "Could not delete next action");
    setBusyId(null);
  }

  function row(a: NextActionRow) {
    if (editingId === a.id) {
      return (
        <NextActionForm
          key={a.id}
          initial={{ text: a.text, dueAt: a.dueAt }}
          saving={busyId === a.id}
          onCancel={() => setEditingId(null)}
          onSave={(v) => update(a.id, v, "Next action updated")}
        />
      );
    }
    const overdue = isOverdue(a);
    return (
      <div key={a.id} className="flex items-start gap-2.5 rounded-lg border border-slate-100 px-3 py-2">
        <input
          type="checkbox"
          checked={!!a.doneAt}
          disabled={!canEdit || busyId === a.id}
          onChange={(e) => update(a.id, { done: e.target.checked }, e.target.checked ? "Marked done" : "Reopened")}
          aria-label={a.doneAt ? "Reopen" : "Mark done"}
          className="mt-1 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className={`text-sm whitespace-pre-wrap ${a.doneAt ? "text-slate-400 line-through" : "text-slate-900 font-medium"}`}>{a.text}</div>
          <div className="text-xs mt-0.5 text-slate-500 flex flex-wrap gap-x-2">
            {a.dueAt && (
              <span className={overdue ? "text-red-600 font-medium" : ""}>
                {overdue ? "Overdue · " : "Due "}<span className="font-mono">{fmtDue(a.dueAt)}</span>
              </span>
            )}
            <span>Added by {a.createdByName} · <span className="font-mono">{fmtDate(a.createdAt)}</span></span>
            {a.doneAt && <span>Done{a.doneByName ? ` by ${a.doneByName}` : ""} · <span className="font-mono">{fmtDate(a.doneAt)}</span></span>}
          </div>
        </div>
        {canEdit && !a.doneAt && (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setEditingId(a.id)} className="text-xs font-medium text-slate-500 hover:text-slate-700">Edit</button>
            <button onClick={() => remove(a)} className="text-xs font-medium text-red-500 hover:text-red-700">Delete</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="next-actions" className="card p-4 scroll-mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-slate-900">
          Next actions <span className="text-slate-400 font-normal font-mono">{open.length}</span>
        </h3>
        {canEdit && !adding && (
          <button
            onClick={() => setAdding(true)}
            aria-label="Add next action"
            title="Add next action"
            className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none"
          >
            +
          </button>
        )}
      </div>
      {adding && (
        <div className="mb-3">
          <NextActionForm initial={{ text: "", dueAt: null }} saving={busyId === "new"} onCancel={() => setAdding(false)} onSave={add} />
        </div>
      )}
      {open.length === 0 && !adding ? (
        <p className="text-sm text-slate-400">No open next actions.</p>
      ) : (
        <div className="space-y-2">{open.map(row)}</div>
      )}
      {done.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowDone((v) => !v)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
            {showDone ? "Hide" : "Show"} {done.length} done
          </button>
          {showDone && <div className="space-y-2 mt-2">{done.map(row)}</div>}
        </div>
      )}
    </div>
  );
}
