"use client";

// Start a handoff: COVER (temporary, with an end date) or TAKE OVER (permanent,
// admin-approved) a customer/deal. Opened from the chat bubble with no target,
// so step 1 picks the customer/deal; step 2 picks the teammate + terms. (If a
// record is passed in, step 1 is skipped.) Pickers reuse the mention search.
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

type Person = { id: string; label: string };
type RecordPick = { entityType: "account_contact" | "deal"; entityId: string; label: string };

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function HandoffModal({
  entityType,
  entityId,
  onClose,
  onDone,
}: {
  entityType?: "account_contact" | "deal";
  entityId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const preTargeted = !!(entityType && entityId);
  const [record, setRecord] = useState<RecordPick | null>(preTargeted ? { entityType: entityType!, entityId: entityId!, label: "" } : null);

  // Step 1 — record search (customers/leads/deals).
  const [rq, setRq] = useState("");
  const [records, setRecords] = useState<{ refType: string; id: string; label: string; sublabel?: string }[]>([]);
  useEffect(() => {
    if (record) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/mentions/search?q=${encodeURIComponent(rq)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setRecords([...(data.customers ?? []), ...(data.leads ?? []), ...(data.deals ?? [])]);
      } catch {
        /* ignore */
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [record, rq]);

  // Step 2 — terms.
  const [kind, setKind] = useState<"COVERAGE" | "TAKEOVER">("COVERAGE");
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [to, setTo] = useState<Person | null>(null);
  const [coverageEnd, setCoverageEnd] = useState(inDays(3));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!record || to) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/mentions/search?q=${encodeURIComponent(q)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setPeople((data.people ?? []).map((p: Person) => ({ id: p.id, label: p.label })));
      } catch {
        /* ignore */
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [record, q, to]);

  async function submit() {
    if (!record || !to) return;
    setSaving(true);
    try {
      const res = await fetch("/api/chat/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          entityType: record.entityType,
          entityId: record.entityId,
          toUserId: to.id,
          note: note.trim() || undefined,
          coverageEnd: kind === "COVERAGE" ? new Date(`${coverageEnd}T18:00:00`).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error === "cannot_hand_off_to_self" ? "You can't hand off to yourself" : "Could not send request");
        return;
      }
      toast.success(kind === "COVERAGE" ? "Coverage requested" : "Takeover requested");
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const noun = record?.entityType === "deal" ? "deal" : "customer";

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        {/* Step 1 — pick the record */}
        {!record ? (
          <>
            <h2 className="font-semibold text-slate-900 mb-3">Hand off — pick a customer or deal</h2>
            <input
              value={rq}
              onChange={(e) => setRq(e.target.value)}
              autoFocus
              placeholder="Search a customer or deal…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
              {records.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-400">Type to search…</div>
              ) : (
                records.map((r) => (
                  <button
                    key={`${r.refType}:${r.id}`}
                    onClick={() => setRecord({ entityType: r.refType === "deal" ? "deal" : "account_contact", entityId: r.id, label: r.label })}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center gap-1.5"
                  >
                    <span>{r.refType === "deal" ? "📁" : "🏢"}</span>
                    <span className="font-medium text-slate-800 truncate">{r.label}</span>
                    {r.sublabel && <span className="text-xs text-slate-400 truncate">{r.sublabel}</span>}
                  </button>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Hand off {record.label ? `— ${record.label}` : `this ${noun}`}</h2>
              {!preTargeted && <button onClick={() => { setRecord(null); setTo(null); }} className="text-xs text-slate-400 hover:text-slate-700">change</button>}
            </div>

            <div className="flex gap-2 mb-3">
              {(["COVERAGE", "TAKEOVER"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${
                    kind === k ? "bg-wa-green/10 border-wa-green text-wa-dark" : "border-slate-200 text-slate-500"
                  }`}
                >
                  {k === "COVERAGE" ? "Cover (temporary)" : "Take over (permanent)"}
                </button>
              ))}
            </div>

            <label className="text-xs font-medium text-slate-600">Teammate</label>
            {to ? (
              <div className="mt-1 mb-2 flex items-center justify-between border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{to.label}</span>
                <button onClick={() => { setTo(null); setQ(""); }} className="text-slate-400 hover:text-slate-700 text-xs">change</button>
              </div>
            ) : (
              <div className="mt-1 mb-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search teammates…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                {people.length > 0 && (
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200">
                    {people.map((p) => (
                      <button key={p.id} onClick={() => setTo(p)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {kind === "COVERAGE" && (
              <div className="mb-2">
                <label className="text-xs font-medium text-slate-600">Cover until</label>
                <input type="date" value={coverageEnd} min={inDays(0)} onChange={(e) => setCoverageEnd(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}

            <div className="mb-3">
              <label className="text-xs font-medium text-slate-600">Note (optional)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Context for your teammate…" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            {kind === "TAKEOVER" && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-3">
                A takeover permanently moves ownership once an admin approves it.
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={onClose} disabled={saving} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Cancel</button>
              <button onClick={submit} disabled={saving || !to} className="flex-1 bg-wa-green hover:bg-wa-green/90 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">
                {saving ? "Sending…" : "Send request"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
