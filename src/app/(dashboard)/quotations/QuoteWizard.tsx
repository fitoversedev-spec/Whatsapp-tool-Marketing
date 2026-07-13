"use client";

// 3-step quotation wizard. Driven by parent (inbox header or /quotations
// page) which controls open/close. Submitting Step 3 fires the send-to-
// WhatsApp endpoint and the modal closes with onComplete().
//
// The wizard creates a draft quotation on Step 2 submit so the preview
// (Step 3) can fetch a real PDF from /api/quotations/[id]/pdf. If the
// user cancels at Step 3, the draft remains in DB (cleanable from the
// /quotations page filter "Drafts").

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { useUserUnit } from "@/lib/units/useUserUnit";
import { toFeet, toUnit } from "@/lib/units";
import { sectionForItem, orderedSectionsFor } from "@/lib/quotation/sections";

type RateSheetItem = {
  id: string;
  name: string;
  description: string;
  areaMode: "plot" | "wrap" | "per_piece" | "perimeter";
  defaultRate: number;
  gstPercent: number;
  wrapHeightFt?: number;
  optional?: boolean;
  section?: string;
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
  // Optional product photo shown at the top of this item's description in the
  // PDF. Set from the "Products" step (auto-matched, reassignable).
  imageUrl?: string | null;
  // Scope section this line groups under (Base Preparation, Lights…).
  section?: string;
  // Unit shown in the quote's UNIT column (sq ft / nos / rft / LS …).
  unit?: string | null;
};

// Catalogue product row (subset of ProductDTO) shown in the Products step.
type ProductRow = {
  id: string;
  name: string;
  sports: string[];
  heroImageUrl: string | null;
};

// A product picked in the Products step, plus which line item shows its photo.
type PickedProduct = {
  productId: string;
  name: string;
  imageUrl: string;
  lineItemId: string | null;
  // True when the user explicitly chose "— none —" for this photo. Lets the
  // auto-match on re-entering Step 3 tell a deliberate detach apart from a
  // never-assigned photo, so it doesn't silently re-attach.
  photoNone?: boolean;
};

// Derive a line item's area from the plot dimensions per its rate-sheet mode.
// Returns null for per-piece / manual modes, which must not be auto-recomputed.
function areaForRate(
  r: RateSheetItem,
  lengthFt: number,
  widthFt: number,
): number | null {
  switch (r.areaMode) {
    case "plot":
      return lengthFt * widthFt;
    case "wrap":
      return (lengthFt + widthFt) * 2 * (r.wrapHeightFt ?? 35) + lengthFt * widthFt;
    case "perimeter":
      return (lengthFt + widthFt) * 2;
    default:
      return null;
  }
}

// Auto-match a product to the most relevant line item by shared words
// (singular/plural-insensitive), so e.g. a "…Turf…" product lands on the
// "Artificial Turf…" line rather than "Sub Base".
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );
}
function bestLineItemId(
  productName: string,
  items: { id: string; name: string; included: boolean }[],
): string | null {
  const a = tokenize(productName);
  let bestId: string | null = null;
  let bestScore = 0;
  for (const it of items) {
    if (!it.included) continue;
    const b = tokenize(it.name);
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    if (n > bestScore) {
      bestScore = n;
      bestId = it.id;
    }
  }
  // No word overlap → fall back to the first included item; the user can move
  // the photo to the right line from the Products-photos panel.
  return bestId ?? items.find((i) => i.included)?.id ?? null;
}

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
  { id: "cricket", label: "Cricket", enabled: true },
  { id: "tennis", label: "Tennis", enabled: true },
  { id: "volleyball", label: "Volleyball", enabled: true },
  { id: "badminton", label: "Badminton", enabled: true },
];

export default function QuoteWizard({ open, onClose, onComplete, prefill }: Props) {
  const toast = useToast();
  const { unit, setUnit } = useUserUnit();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [customerName, setCustomerName] = useState(prefill?.customerName ?? "");
  const [sport, setSport] = useState("football");
  const [lengthFt, setLengthFt] = useState(60);
  const [widthFt, setWidthFt] = useState(100);
  // User's preferred unit view of the dimensions; storage always feet.
  const displayLen = unit === "ft" ? lengthFt : Number(toUnit(lengthFt, unit).toFixed(1));
  const displayWid = unit === "ft" ? widthFt : Number(toUnit(widthFt, unit).toFixed(1));
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [validityDays, setValidityDays] = useState(30);
  const [notes, setNotes] = useState("");

  // Step 2 state — Products (pick catalogue products → their photos attach to
  // line items in the next step)
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productFilter, setProductFilter] = useState<string>("");
  const [picked, setPicked] = useState<PickedProduct[]>([]);

  // Step 3 state — line items / quote table
  const [rateSheet, setRateSheet] = useState<RateSheetItem[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  // Sport the current line items were built for — so re-entering the line-items
  // step doesn't wipe edits unless the sport actually changed.
  const ratesLoadedForSport = useRef<string | null>(null);

  // Step 3 state
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftNumber, setDraftNumber] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Customer-facing caption. Sent as a preceding text message so
  // WhatsApp displays it instead of hiding it under the document
  // thumbnail. Empty = server uses default.
  const [caption, setCaption] = useState("");

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
      setPicked([]);
      setProductFilter("");
      ratesLoadedForSport.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load the product catalogue when entering the Products step; default the
  // sport filter to the sport chosen in Step 1.
  useEffect(() => {
    if (step !== 2) return;
    setProductFilter((f) => f || sport);
    if (products.length > 0) return;
    setLoadingProducts(true);
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d: { products: ProductRow[] }) => setProducts(d.products ?? []))
      .finally(() => setLoadingProducts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Load rate sheet when entering the line-items step (Step 3). Keeps existing
  // edits when the sport hasn't changed; only rebuilds on a fresh sport.
  useEffect(() => {
    if (step !== 3) return;
    // Same sport + items already built → keep edits, just (re)attach photos.
    if (ratesLoadedForSport.current === sport && lineItems.length > 0) {
      // Recompute dimension-derived areas from the CURRENT plot size — the user
      // may have gone Back to Step 1 and changed length/width since these items
      // were built, which otherwise bills a stale (wrong-money) area/total.
      setLineItems((prev) =>
        prev.map((li) => {
          const r = rateSheet.find((x) => x.id === li.id);
          const area = r ? areaForRate(r, lengthFt, widthFt) : null;
          return area == null
            ? li
            : { ...li, areaSqFt: area, total: area * li.ratePerSqFt };
        }),
      );
      setPicked((prev) =>
        prev.map((p) =>
          (p.lineItemId && lineItems.some((li) => li.id === p.lineItemId)) ||
          p.photoNone
            ? p
            : { ...p, lineItemId: bestLineItemId(p.name, lineItems) },
        ),
      );
      return;
    }
    setLoadingRates(true);
    fetch(`/api/quotations/rates?sport=${encodeURIComponent(sport)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items: RateSheetItem[] }) => {
        setRateSheet(data.items ?? []);
        // Build initial line items
        const initial = (data.items ?? []).map((r) => {
          const area = areaForRate(r, lengthFt, widthFt) ?? 0;
          return {
            id: r.id,
            name: r.name,
            description: r.description,
            areaSqFt: area,
            ratePerSqFt: r.defaultRate,
            gstPercent: r.gstPercent,
            total: area * r.defaultRate,
            included: !r.optional,
            section: sectionForItem(r),
            unit:
              r.areaMode === "per_piece"
                ? "nos"
                : r.areaMode === "perimeter"
                  ? "rft"
                  : "sq ft",
          };
        });
        setLineItems(initial);
        ratesLoadedForSport.current = sport;
        // Auto-match each picked product's photo to the best line item (keep a
        // still-valid manual assignment, and an explicit "— none —", intact).
        setPicked((prev) =>
          prev.map((p) =>
            (p.lineItemId && initial.some((li) => li.id === p.lineItemId)) ||
            p.photoNone
              ? p
              : { ...p, lineItemId: bestLineItemId(p.name, initial) },
          ),
        );
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
    // Excluding a line detaches any product photo pinned to it, so the photo
    // select, the "📷 attached" indicator and the submit payload stay in sync.
    // (An excluded line is dropped from the PDF, so its photo would otherwise
    // silently vanish while the UI still claimed it was attached.)
    if (key === "included" && value === false) {
      setPicked((prev) =>
        prev.map((p) => (p.lineItemId === id ? { ...p, lineItemId: null } : p)),
      );
    }
  }

  // Products step: filter by sport, toggle a product in/out of the shortlist.
  const filteredProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          !productFilter ||
          productFilter === "all" ||
          p.sports.includes(productFilter),
      ),
    [products, productFilter],
  );

  function togglePick(p: ProductRow) {
    if (!p.heroImageUrl) return; // no photo → nothing to attach
    setPicked((prev) =>
      prev.some((x) => x.productId === p.id)
        ? prev.filter((x) => x.productId !== p.id)
        : [
            ...prev,
            {
              productId: p.id,
              name: p.name,
              imageUrl: p.heroImageUrl!,
              lineItemId: null,
            },
          ],
    );
  }

  // Attach each picked product's photo to its assigned line item for the API.
  function lineItemsForSubmit(): LineItem[] {
    return lineItems.map((li) => ({
      ...li,
      imageUrl: picked.find((p) => p.lineItemId === li.id)?.imageUrl ?? null,
    }));
  }

  function step1Valid(): boolean {
    return (
      customerName.trim().length > 0 &&
      lengthFt > 0 &&
      widthFt > 0 &&
      [
        "football",
        "basketball",
        "multisport",
        "pickleball",
        "tennis",
        "volleyball",
        "cricket",
        "badminton",
      ].includes(sport)
    );
  }

  async function submitStep2() {
    if (!step1Valid() || lineItems.filter((i) => i.included).length === 0) {
      toast.error("Add at least one included line item");
      return;
    }
    // Resolve the quote date up front. A cleared date input yields "", and
    // `new Date("T12:00:00").toISOString()` throws a RangeError — which, when
    // done inline in the fetch body below, was caught by the network catch and
    // mis-reported as "Network error". Validate it here with a clear message.
    const quoteDateObj = quoteDate ? new Date(`${quoteDate}T12:00:00`) : null;
    if (!quoteDateObj || Number.isNaN(quoteDateObj.getTime())) {
      toast.error("Please choose a valid quote date");
      return;
    }
    const quoteDateIso = quoteDateObj.toISOString();
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
            lineItems: lineItemsForSubmit(),
            notes: notes.trim() || undefined,
            quoteDate: quoteDateIso,
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
      setStep(4);
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
      const res = await fetch(`/api/quotations/${draftId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: caption.trim() || null }),
      });
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
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] max-h-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              📄 New Quotation
            </h2>
            <div className="text-xs text-slate-500 mt-0.5">Step {step} of 4</div>
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
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${
                s <= step ? "bg-wa-green" : "bg-slate-200"
              }`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 w-full max-w-5xl mx-auto">
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
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Plot dimensions *
                  </label>
                  {/* Inline unit toggle. Persists to the user's profile
                      so every wizard + PDF respects it going forward. */}
                  <div className="inline-flex bg-slate-100 rounded-md p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setUnit("ft")}
                      className={`px-2.5 py-1 rounded font-medium transition ${
                        unit === "ft"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      ft
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnit("m")}
                      className={`px-2.5 py-1 rounded font-medium transition ${
                        unit === "m"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      m
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      step={unit === "m" ? 0.1 : 1}
                      value={displayLen}
                      onChange={(e) =>
                        setLengthFt(
                          Math.round(toFeet(parseFloat(e.target.value) || 0, unit))
                        )
                      }
                      className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                    />
                    <span className="text-sm text-slate-500">{unit}</span>
                  </div>
                  <span className="text-slate-400">×</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      step={unit === "m" ? 0.1 : 1}
                      value={displayWid}
                      onChange={(e) =>
                        setWidthFt(
                          Math.round(toFeet(parseFloat(e.target.value) || 0, unit))
                        )
                      }
                      className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                    />
                    <span className="text-sm text-slate-500">{unit}</span>
                  </div>
                  <span className="text-sm font-medium text-slate-700 ml-2">
                    {unit === "ft"
                      ? `= ${(lengthFt * widthFt).toLocaleString("en-IN")} sq.ft`
                      : `= ${Math.round(lengthFt * widthFt * 0.0929).toLocaleString("en-IN")} m² (${(lengthFt * widthFt).toLocaleString("en-IN")} sq.ft)`}
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
            <div className="space-y-4">
              <div className="text-sm text-slate-600">
                Optional — pick the products you&apos;re quoting. Each product&apos;s
                photo is placed at the top of the best-matching line item&apos;s
                description (you can move it in the next step). Skip if you
                don&apos;t need photos.
              </div>

              {/* Sport filter (defaults to the sport chosen in Step 1) */}
              <div className="flex flex-wrap gap-1.5">
                {[{ id: "all", label: "All sports" }, ...SPORTS.map((s) => ({ id: s.id, label: s.label }))].map(
                  (s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setProductFilter(s.id)}
                      className={`px-3 py-1.5 text-xs rounded-full border transition ${
                        (productFilter || sport) === s.id
                          ? "bg-wa-green text-white border-wa-green"
                          : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
                      }`}
                    >
                      {s.label}
                    </button>
                  ),
                )}
              </div>

              {loadingProducts ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  Loading products…
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  No products for this filter.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredProducts.map((p) => {
                    const isPicked = picked.some((x) => x.productId === p.id);
                    const noPhoto = !p.heroImageUrl;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePick(p)}
                        disabled={noPhoto}
                        className={`relative text-left rounded-lg border overflow-hidden transition ${
                          isPicked
                            ? "border-wa-green ring-2 ring-wa-green/30"
                            : "border-slate-200 hover:border-slate-300"
                        } ${noPhoto ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <div className="aspect-[4/3] bg-slate-100 flex items-center justify-center">
                          {p.heroImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.heroImageUrl}
                              alt={p.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-400">No photo</span>
                          )}
                        </div>
                        <div className="px-2 py-1.5 text-xs font-medium text-slate-800 truncate">
                          {p.name}
                        </div>
                        {isPicked && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-wa-green text-white text-xs flex items-center justify-center shadow">
                            ✓
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {picked.length > 0 && (
                <div className="text-xs text-slate-500">
                  {picked.length} product photo{picked.length > 1 ? "s" : ""} selected
                  — they&apos;ll attach to the matching line items next.
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {loadingRates ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading rates…</div>
              ) : (
                <>
                  <div className="text-sm text-slate-600 mb-2">
                    Customize area, rate, description per item. Toggle off items not needed.
                  </div>

                  {/* Product photos — auto-matched to a line item, reassignable */}
                  {picked.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                        Product photos
                      </div>
                      <div className="text-[11px] text-slate-500 -mt-1">
                        Each photo sits at the top of the chosen line item&apos;s
                        description in the PDF. Move it if the match is wrong.
                      </div>
                      {picked.map((p) => (
                        <div
                          key={p.productId}
                          className="flex items-center gap-3 bg-white border border-slate-200 rounded-md p-2"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="w-12 h-12 object-cover rounded border border-slate-200 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-800 truncate">
                              {p.name}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-[11px] text-slate-500 shrink-0">
                                Show on:
                              </span>
                              <select
                                value={p.lineItemId ?? ""}
                                onChange={(e) =>
                                  setPicked((prev) =>
                                    prev.map((x) =>
                                      x.productId === p.productId
                                        ? {
                                            ...x,
                                            lineItemId: e.target.value || null,
                                            // Empty value = user explicitly chose
                                            // "— none —"; remember it so re-entering
                                            // Step 3 doesn't auto-reattach a photo.
                                            photoNone: e.target.value === "",
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                className="text-xs border border-slate-300 rounded px-2 py-1 bg-white min-w-0 flex-1"
                              >
                                <option value="">— none —</option>
                                {lineItems
                                  .filter((li) => li.included)
                                  .map((li) => (
                                    <option key={li.id} value={li.id}>
                                      {li.name}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setPicked((prev) =>
                                prev.filter((x) => x.productId !== p.productId),
                              )
                            }
                            className="text-xs text-red-500 hover:underline shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {orderedSectionsFor(lineItems.map((i) => sectionForItem(i))).map((section) => {
                    const secItems = lineItems.filter((i) => sectionForItem(i) === section);
                    return (
                      <div key={section} className="space-y-2">
                        <div className="flex items-center gap-2 pt-1">
                          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide whitespace-nowrap">
                            {section}
                          </h4>
                          <span className="text-[10px] text-slate-400">
                            {secItems.filter((i) => i.included).length}/{secItems.length}
                          </span>
                          <div className="flex-1 border-t border-slate-200" />
                        </div>

                        {secItems.map((item) => (
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
                                <div className="flex items-start gap-2">
                                  <input
                                    value={item.name}
                                    onChange={(e) => updateLineItem(item.id, "name", e.target.value)}
                                    className="flex-1 min-w-0 text-base font-semibold text-slate-900 bg-transparent border-0 border-b border-transparent hover:border-slate-300 focus:border-wa-green focus:outline-none focus:ring-0 px-0 py-1"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setLineItems((prev) => prev.filter((x) => x.id !== item.id))}
                                    className="shrink-0 mt-1 text-xs text-red-500 hover:text-red-700 px-1"
                                    title="Remove this line"
                                  >
                                    ✕
                                  </button>
                                </div>
                                {picked.some((p) => p.lineItemId === item.id) && (
                                  <div className="text-[10px] text-wa-dark mt-0.5">
                                    📷 Product photo attached — shows at the top of this
                                    description in the PDF
                                  </div>
                                )}
                                <textarea
                                  value={item.description}
                                  onChange={(e) => updateLineItem(item.id, "description", e.target.value)}
                                  rows={5}
                                  className="w-full mt-1.5 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2.5 focus:outline-none focus:ring-1 focus:ring-wa-green/30 focus:border-wa-green resize-y leading-relaxed min-h-[6rem]"
                                />
                                <div className="grid grid-cols-5 gap-2 mt-2">
                                  <div>
                                    <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                                      Qty
                                    </label>
                                    <input
                                      type="number"
                                      min={0}
                                      value={item.areaSqFt}
                                      onChange={(e) => updateLineItem(item.id, "areaSqFt", parseFloat(e.target.value) || 0)}
                                      disabled={!item.included}
                                      className="w-full px-2.5 py-2 text-base border border-slate-300 rounded-md text-right focus:outline-none focus:ring-1 focus:ring-wa-green/30"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
                                      Unit
                                    </label>
                                    <input
                                      value={item.unit ?? "sq ft"}
                                      onChange={(e) => updateLineItem(item.id, "unit", e.target.value)}
                                      disabled={!item.included}
                                      className="w-full px-2.5 py-2 text-base border border-slate-300 rounded-md text-center focus:outline-none focus:ring-1 focus:ring-wa-green/30"
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
                                      className="w-full px-2.5 py-2 text-base border border-slate-300 rounded-md text-right focus:outline-none focus:ring-1 focus:ring-wa-green/30"
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
                                      className="w-full px-2.5 py-2 text-base border border-slate-300 rounded-md text-right focus:outline-none focus:ring-1 focus:ring-wa-green/30"
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
                              </div>
                            </div>
                          </div>
                        ))}

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
                                section,
                                unit: "sq ft",
                              },
                            ]);
                          }}
                          className="w-full py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-wa-green hover:text-wa-dark transition"
                        >
                          + Add item to {section}
                        </button>
                      </div>
                    );
                  })}

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

          {step === 4 && draftId && (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900">
                ✓ Draft <strong>{draftNumber}</strong> created. Preview below — if everything looks
                good, click <strong>Send to customer</strong>.
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50" style={{ height: "50vh" }}>
                <iframe
                  src={`/api/quotations/${draftId}/pdf`}
                  className="w-full h-full"
                  title="Quotation preview"
                />
              </div>
              {/* Caption — sent as a text message BEFORE the PDF so the
                  customer always sees it (WhatsApp hides document
                  captions under the file thumbnail). */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
                  Message to send with the PDF
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                  placeholder={`Quotation ${draftNumber ?? ""} from Fitoverse — total ₹${totals.grandTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 resize-none"
                />
                <div className="text-[10px] text-slate-500 mt-1">
                  Sent as its own message right before the PDF. Leave empty
                  to use the default.
                </div>
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
            {step > 1 && step < 4 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
              >
                ← Back
              </button>
            )}
            {step === 4 && (
              <button
                onClick={() => setStep(3)}
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
                onClick={() => setStep(3)}
                className="px-5 py-2 text-sm font-medium bg-wa-green text-white rounded-md hover:bg-wa-green/90"
              >
                {picked.length > 0 ? "Next →" : "Skip →"}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={submitStep2}
                disabled={submitting}
                className="px-5 py-2 text-sm font-medium bg-wa-green text-white rounded-md disabled:opacity-50 hover:bg-wa-green/90"
              >
                {submitting ? "Creating…" : "Generate Preview →"}
              </button>
            )}
            {step === 4 && (
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
