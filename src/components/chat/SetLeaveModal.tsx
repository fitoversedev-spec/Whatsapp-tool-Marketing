"use client";

// Mark yourself out-of-office for a date range so the team knows you're away.
import { useState } from "react";
import { useToast } from "@/components/Toast";

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function SetLeaveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [start, setStart] = useState(inDays(0));
  const [end, setEnd] = useState(inDays(3));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (new Date(end) < new Date(start)) {
      toast.error("End date must be after start");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/chat/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: new Date(`${start}T00:00:00`).toISOString(),
          endsAt: new Date(`${end}T23:59:59`).toISOString(),
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        toast.error("Could not set your leave");
        return;
      }
      toast.success("Leave set — your team can now cover for you");
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-slate-900 mb-3">Set your leave</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-medium text-slate-600">From</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">To</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mb-3">
          <label className="text-xs font-medium text-slate-600">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Back Monday" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : "Set leave"}
          </button>
        </div>
      </div>
    </div>
  );
}
