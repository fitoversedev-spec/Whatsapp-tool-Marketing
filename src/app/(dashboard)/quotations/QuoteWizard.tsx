"use client";

// 3-step quotation wizard. Driven by parent (inbox header or /quotations
// page) which controls open/close. Submitting Step 3 fires the send-to-
// WhatsApp endpoint and the modal closes with onComplete().
//
// The wizard creates a draft quotation on Step 2 submit so the preview
// (Step 3) can fetch a real PDF from /api/quotations/[id]/pdf. If the
// user cancels at Step 3, the draft remains in DB (cleanable from the
// /quotations page filter "Drafts").

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";

type RateSheetItem = {
  id: string;
  name: string;
  description: string;
  areaMode: "plot" | "wrap" | "per_piece" | "perimeter";
  defaultRate: number;
  gstPercent: number;
  wrapHeightFt?: number;
  optional?: boolean;
};

type LineItem = {
  id: string;
  name: string;
  description: string;
  areaSqFt: number;
  ratePerSqFt: number;
  gstPercent: number;
  total: number;
  included: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: { quotationId: string; sent: boolean }) => void;
  // When triggered from inbox, these pre-fill Step 1
  prefill?: {
    customerName?: string;
    contactPhone?: string;
    conversationId?: string;
  };
};

const SPORTS = [
  { id: "football", label: "Football", enabled: true },
  { id: "basketball", label: "Basketball", enabled: true },
  { id: "multisport", label: "Multisport", enabled: true },
  { id: "pickleball", label: "Pickleball", enabled: true },
  { id: "cricket", label: "Cricket", enabled: false },
  { id: "tennis", label: "Tennis", enabled: false },
];

export default function QuoteWizard({ open, onClose, onComplete, prefill }: Props) {
  const toast = useToast();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [customerName, setCustomerName] = useState(prefill?.customerName ?? "");
  const [sport, setSport] = useState("football");
  const [lengthFt, setLengthFt] = useState(60);
  const [widthFt, setWidthFt] = useState(100);
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [validityDays, setValidityDays] = useState(30);
  const [notes, setNotes] = useState("");

  // Step 2 state
  const [rateSheet, setRateSheet] = useState<RateSheetItem[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);

  // Step 3 state
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftNumber, setDraftNumber] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when modal opens fresh
  useEffect(() => {
    if (open) {
      setStep(1);
      setCustomerName(prefill?.customerName ?? "");
      setLengthFt(60);
      setWidthFt(100);
      setQuoteDate(new Date().toISOString().slice(0, 10));
      setValidityDays(30);
      setNotes("");
      setDraftId(null);
      setDraftNumber(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load rate sheet when entering Step 2. Re-fetches if sport changed.
  useEffect(() => {
    if (step !== 2) return;
    setLoadingRates(true);
    fetch(`/api/quotations/rates?sport=${encodeURIComponent(sport)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items: RateSheetItem[] }) => {
        setRateSheet(data.items ?? []);
        // Build initial line items
        const initial = (data.items ?? []).map((r) => {
          const area =
            r.areaMode === "plot"
              ? lengthFt * widthFt
              : r.areaMode === "wrap"
                ? (lengthFt + widthFt) * 2 * (r.wrapHeightFt ?? 35) + lengthFt * widthFt
                : r.areaMode === "perimeter"
                  ? (lengthFt + widthFt) * 2
                  : 0;
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            areaSqFt: area,
            ratePerSqFt: r.defaultRate,
            gstPercent: r.gstPercent,
            total: area * r.defaultRate,
            included: !r.optional,
          };
        });
        setLineItems(initial);
      })
      .finally(() => setLoadingRates(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Compute totals from line items
  const totals = useMemo(() => {
    let subtotal = 0;
    let gstAmount = 0;
    for (const item of lineItems) {
      if (!item.included) continue;
      const lineTotal = item.areaSqFt * item.ratePerSqFt;
      subtotal += lineTotal;
      gstAmount += (lineTotal * item.gstPercent) / 100;
    }
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      gstAmount: Math.round(gstAmount * 100) / 100,
      grandTotal: Math.round((subtotal + gstAmount) * 100) / 100,
    };
  }, [lineItems]);

  function updateLineItem<K extends keyof LineItem>(id: string, key: K, value: LineItem[K]) {
    setLineItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, [key]: value };
        next.total = next.areaSqFt * next.ratePerSqFt;
        return next;
      })
    );
  }

  function step1Valid(): boolean {
    return (
      customerName.trim().length > 0 &&
      lengthFt > 0 &&
      widthFt > 0 &&
      ["football", "basketball", "multisport", "pickleball"].includes(sport)
    );
  }

  async function submitStep2() {
    if (!step1Valid() || lineItems.filter((i) => i.included).length === 0) {
      toast.error("Add at least one included line item");
      return;
    }
    setSubmitting(true);
    try {
      let res: Response;
      try {
        res = await fetch("/api/quotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: customerName.trim(),
            sport,
            lengthFt,
            widthFt,
            lineItems,
            notes: notes.trim() || undefined,
            quoteDate: new Date(quoteDate + "T12:00:00").toISOString(),
            validityDays,
            conversationId: prefill?.conversationId ?? null,
            contactPhone: prefill?.contactPhone ?? null,
          }),
        });
      } catch (err) {
        // Network failure / CORS / aborted request — fetch never resolved
        // so there's no response object to inspect. Surface it instead of
        // letting the button silently re-enable.
        toast.error(
          "Network error reaching the server. Check your internet and try again."
        );
        console.error("[QuoteWizard] fetch /api/quotations threw", err);
        return;
      }

      // Try to parse the response body as JSON. If the server returned an
      // HTML error page (Vercel 502, Cloudflare block, etc.), .json()
      // throws — capture the raw text instead so we can surface a useful
      // message rather than silently failing.
      let data: { quotation?: { id: string; number: string }; error?: string } | null = null;
      let rawText: string | null = null;
      try {
        const cloned = res.clone();
        data = await res.json();
        // also keep raw in case we need it for debugging
        rawText = await cloned.text().catch(() => null);
      } catch {
        rawText = await res.text().catch(() => null);
      }

      if (!res.ok || !data?.quotation) {
        // Status-aware error so the user gets something actionable.
        const generic =
          res.status === 401
            ? "Session expired — please sign in again."
            : res.status === 413
              ? "Quotation too large to save."
              : res.status >= 500
                ? `Server error (${res.status}). The team has been notified.`
                : `Could not create draft (${res.status}).`;
        const message = data?.error ?? rawText?.slice(0, 200) ?? generic;
        toast.error(message);
        console.error("[QuoteWizard] /api/quotations failed", {
          status: res.status,
          body: rawText,
        });
        return;
      }

      setDraftId(data.quotation.id);
      setDraftNumber(data.quotation.number);
      setStep(3);
    } finally {
      setSubmitting(false);
    }
  }

  async function send() {
    if (!draftId) return;
    if (!prefill?.contactPhone) {
      toast.error(
        "No contact phone available. Open this customer's chat first, then click 📄 Quote."
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/quotations/${draftId}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Send failed");
        return;
      }
      toast.success(`Quotation ${draftNumber} sent to ${customerName}`);
      onComplete({ quotationId: draftId, sent: true });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function downloadDraftPdf() {
    if (!draftId) return;
    window.open(`/api/quotations/${draftId}/pdf`, "_blank");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              📄 New Quotation
            </h2>
            <div className="text-xs text-slate-500 mt-0.5">Step {step} of 3</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Progress */}
        <div className="px-5 sm:px-6 py-2 flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${
                s <= step ? "bg-wa-green" : "bg-slate-200"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Customer name *
                </label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Dr. P. Prabhusankar"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Sport *
                </label>
                <div className="flex flex-wrap gap-2">
                  {SPORTS.map((s) => (
                    <label
                      key={s.id}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-md text-sm cursor-pointer transition ${
                        sport === s.id
                          ? "border-wa-green bg-wa-green/10 text-wa-dark font-medium"
                          : s.enabled
                            ? "border-slate-300 hover:border-slate-400"
                            : "border-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                      }`}
                      title={s.enabled ? "" : "Coming soon"}
                    >
                      <input
                        type="radio"
                        name="sport"
                        value={s.id}
                        checked={sport === s.id}
                        disabled={!s.enabled}
                        onChange={(e) => setSport(e.target.value)}
                        className="sr-only"
                      />
                      {s.label}
                      {!s.enabled && <span className="text-[10px]">(soon)</span>}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Plot dimensions *
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={lengthFt}
                      onChange={(e) => setLengthFt(parseInt(e.target.value) || 0)}
                      className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                    />
                    <span className="text-sm text-slate-500">ft</span>
                  </div>
                  <span className="text-slate-400">×</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={widthFt}
                      onChange={(e) => setWidthFt(parseInt(e.target.value) || 0)}
                      className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                    />
                    <span className="text-sm text-slate-500">ft</span>
                  </div>
                  <span className="text-sm font-medium text-slate-700 ml-2">
                    = {(lengthFt * widthFt).toLocaleString("en-IN")} sq.ft
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Quote date
                  </label>
                  <input
                    type="date"
                    value={quoteDate}
                    onChange={(e) => setQuoteDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Validity (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={validityDays}
                    onChange={(e) => setValidityDays(parseInt(e.target.value) || 30)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Additional notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Any custom notes for this customer…"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 focus:border-wa-green resize-none"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {loadingRates ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading rates…</div>
              ) : (
                <>
                  <div className="text-sm text-slate-600 mb-2">
                    Customize area, rate, description per item. Toggle off items not needed.
                  </div>
                  {lineItems.map((item) => (
                    <div
                      key={item.id}
                      className={`border rounded-lg p-3 transition ${
                        item.included
                          ? "border-slate-300 bg-white"
                          : "border-slate-200 bg-slate-50 opacity-60"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={item.included}
                          onChange={(e) => updateLineItem(item.id, "included", e.target.checked)}
                          className="mt-1.5"
                        />
                        <div className="flex-1 min-w-0">
                          <input
                            value={item.name}
                            onChange={(e) => updateLineItem(item.id, "name", e.target.value)}
                            className="w-full text-sm font-semibold text-slate-900 bg-transparent border-0 border-b border-transparent hover:border-slate-300 focus:border-wa-green focus:outline-none focus:ring-0 px-0 py-0.5"
                          />
                          <textarea
                            value={item.description}
                            onChange={(e) => updateLineItem(item.id, "description", e.target.value)}
                            rows={2}
                            className="w-full mt-1 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-wa-green/30 focus:border-wa-green resize-none"
                          />
                          <div className="grid grid-cols-4 gap-2 mt-2">
                            <div>
                              <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                                Area
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={item.areaSqFt}
                                onChange={(e) => updateLineItem(item.id, "areaSqFt", parseFloat(e.target.value) || 0)}
                                disabled={!item.included}
                                className="w-full px-2 py-1 text-sm border border-slate-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-wa-green/30"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                                Rate ₹
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={item.ratePerSqFt}
                                onChange={(e) => updateLineItem(item.id, "ratePerSqFt", parseFloat(e.target.value) || 0)}
                                disabled={!item.included}
                                className="w-full px-2 py-1 text-sm border border-slate-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-wa-green/30"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                                GST %
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={item.gstPercent}
                                onChange={(e) => updateLineItem(item.id, "gstPercent", parseFloat(e.target.value) || 0)}
                                disabled={!item.included}
                                className="w-full px-2 py-1 text-sm border border-slate-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-wa-green/30"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                                Total
                              </label>
                              <div className="px-2 py-1 text-sm font-semibold text-right bg-slate-50 border border-slate-200 rounded">
                                ₹ {(item.areaSqFt * item.ratePerSqFt).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                          </div>
                          {item.id.startsWith("custom_") && (
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  setLineItems((prev) => prev.filter((x) => x.id !== item.id))
                                }
                                className="text-xs text-red-600 hover:underline"
                              >
                                Remove custom item
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Add custom line item */}
                  <button
                    type="button"
                    onClick={() => {
                      const newId = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                      setLineItems((prev) => [
                        ...prev,
                        {
                          id: newId,
                          name: "New Item",
                          description: "Describe the work or product…",
                          areaSqFt: lengthFt * widthFt,
                          ratePerSqFt: 0,
                          gstPercent: 18,
                          total: 0,
                          included: true,
                        },
                      ]);
                    }}
                    className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:border-wa-green hover:text-wa-dark transition"
                  >
                    + Add custom line item
                  </button>

                  {/* Totals */}
                  <div className="mt-4 pt-4 border-t border-slate-200 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Subtotal</span>
                      <span className="font-medium">₹ {totals.subtotal.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">GST</span>
                      <span className="font-medium">₹ {totals.gstAmount.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex justify-between text-base pt-2 mt-2 border-t border-slate-100">
                      <span className="font-semibold text-slate-900">Grand Total</span>
                      <span className="font-bold text-wa-dark">
                        ₹ {totals.grandTotal.toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && draftId && (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900">
                ✓ Draft <strong>{draftNumber}</strong> created. Preview below — if everything looks
                good, click <strong>Send to customer</strong>.
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50" style={{ height: "60vh" }}>
                <iframe
                  src={`/api/quotations/${draftId}/pdf`}
                  className="w-full h-full"
                  title="Quotation preview"
                />
              </div>
              <div className="flex justify-between text-sm">
                <button onClick={downloadDraftPdf} className="text-wa-dark hover:underline">
                  ⬇ Download / open in new tab
                </button>
                {!prefill?.contactPhone && (
                  <span className="text-amber-700 text-xs">
                    ⚠ No customer phone — saved as draft, send from /quotations page
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-2 bg-white">
          <div>
            {step > 1 && step < 3 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
              >
                ← Back
              </button>
            )}
            {step === 3 && (
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
              >
                ← Edit
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
            >
              Cancel
            </button>
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={!step1Valid()}
                className="px-5 py-2 text-sm font-medium bg-wa-green text-white rounded-md disabled:opacity-50 hover:bg-wa-green/90"
              >
                Next →
              </button>
            )}
            {step === 2 && (
              <button
                onClick={submitStep2}
                disabled={submitting}
                className="px-5 py-2 text-sm font-medium bg-wa-green text-white rounded-md disabled:opacity-50 hover:bg-wa-green/90"
              >
                {submitting ? "Creating…" : "Generate Preview →"}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={send}
                disabled={submitting || !prefill?.contactPhone}
                className="px-5 py-2 text-sm font-medium bg-wa-green text-white rounded-md disabled:opacity-50 hover:bg-wa-green/90"
              >
                {submitting ? "Sending…" : "🚀 Send to customer"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
