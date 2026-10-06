"use client";

// "Won" — confirm a project: final value, expected start date and a short
// note. Creates the confirmed deal and moves the customer out of Leads. With no
// contact given (Deals page "+ New Deal") it first asks which customer.
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

type Customer = { id: string; name: string; accountName?: string | null };

export default function WonDealModal({
  contact, onClose, onDone,
}: {
  contact: Customer | null;
  onClose: () => void;
  onDone: (deal: { id: string; code: string }) => void;
}) {
  const toast = useToast();
  const [chosen, setChosen] = useState<Customer | null>(contact);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [value, setValue] = useState("");
  const [start, setStart] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const searchSeq = useRef(0);

  // Customer search for "+ New Deal": only customers this user may confirm.
  // Each search is numbered so a slow, older reply can't overwrite a newer one.
  useEffect(() => {
    if (chosen) return;
    const mine = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/account-contacts?editable=1&q=${encodeURIComponent(q.trim())}`).catch(() => null);
      if (mine !== searchSeq.current) return;
      setSearching(false);
      if (!res?.ok) { setSearchFailed(true); return; }
      setSearchFailed(false);
      const data = await res.json();
      if (mine !== searchSeq.current) return;
      setResults(
        (data.contacts ?? []).slice(0, 25).map((c: { id: string; name: string; account?: { name: string } | null }) => ({
          id: c.id,
          name: c.name,
          accountName: c.account?.name ?? null,
        })),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [q, chosen]);

  const amount = Number(value);
  const canSave = !!chosen && Number.isFinite(amount) && amount > 0;

  async function submit() {
    if (!chosen || !canSave || saving) return;
    setSaving(true);
    const res = await fetch(`/api/account-contacts/${chosen.id}/won`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: amount,
        expectedStartAt: start ? new Date(`${start}T09:00:00`).toISOString() : null,
        note: note.trim() || undefined,
      }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (res?.ok) {
      toast.success(`Won — ${data.deal.code} created`);
      onDone(data.deal); // keeps "Saving..." until the parent closes the form
      return;
    }
    // Someone (or another tab) confirmed this customer moments ago.
    if (res?.status === 409 && data?.deal) {
      toast.success(data.error);
      onDone(data.deal);
      return;
    }
    setSaving(false);
    toast.error(
      res?.status === 403
        ? "You can't confirm a deal for this customer"
        : res?.status === 404
          ? "This customer could not be found"
          : data?.error ?? "Could not create the deal",
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()} data-guide="crm-won-dialog">
        <h2 className="font-semibold text-slate-900 mb-1">{contact ? `Won — ${contact.name}` : "New deal"}</h2>
        <p className="text-sm text-slate-600 mb-4">A deal is a confirmed project. The customer moves from Leads to Deals.</p>
        <div className="space-y-3">
          {!contact && (
            <div>
              <label htmlFor="won-customer" className="text-xs font-medium text-slate-600">Customer</label>
              {chosen ? (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">
                    {chosen.name}{chosen.accountName && chosen.accountName !== chosen.name ? <span className="text-slate-500 font-normal"> · {chosen.accountName}</span> : null}
                  </span>
                  <button onClick={() => setChosen(null)} className="text-xs text-court-700 hover:underline">Change</button>
                </div>
              ) : (
                <>
                  <input id="won-customer" value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search contacts by name…" className="mt-1 w-full input" />
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                    {results.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-400">
                        {searching ? "Searching…" : searchFailed ? "Search failed — try again." : "No matches — add the customer in Contacts first."}
                      </p>
                    ) : (
                      results.map((c) => (
                        <button key={c.id} onClick={() => setChosen(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                          <span className="text-slate-900">{c.name}</span>
                          {c.accountName && c.accountName !== c.name && <span className="text-slate-500"> · {c.accountName}</span>}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <div>
            <label htmlFor="won-value" className="text-xs font-medium text-slate-600">Final value (₹) <span className="text-red-500">*</span></label>
            <input id="won-value" type="number" min="1" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 1850000" className="mt-1 w-full input" />
          </div>
          <div>
            <label htmlFor="won-start" className="text-xs font-medium text-slate-600">Expected start date</label>
            <input id="won-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full input" />
          </div>
          <div>
            <label htmlFor="won-note" className="text-xs font-medium text-slate-600">Note</label>
            <textarea id="won-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="e.g. PO received, advance on delivery, 2 courts" className="mt-1 w-full input" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} disabled={saving} className="flex-1 btn btn-secondary">Cancel</button>
          <button onClick={submit} disabled={saving || !canSave} className="flex-1 btn btn-primary disabled:opacity-50">
            {saving ? "Saving..." : "Confirm deal"}
          </button>
        </div>
      </div>
    </div>
  );
}
