"use client";

// Three-step wizard for designing a court image. Step 1 collects the
// sports + plot + sport-specific subconfigs. Step 2 hands the user to the
// Konva editor where everything is movable/resizable/rotatable. Step 3
// renders the PNG, uploads it to blob storage, saves the row, and (on
// confirm) sends it to the customer over WhatsApp.
//
// Same UX shape as QuoteWizard so sales gets a consistent flow.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useToast } from "@/components/Toast";
import ElementInspector from "@/components/court-image/ElementInspector";
import DesignAttachments, {
  type AttachmentTab,
  type Attachments,
} from "@/components/court-image/DesignAttachments";
import {
  resolveColorName,
  knownColorNames,
} from "@/lib/court-image/color-names";
import type { CourtCanvasHandle } from "@/components/court-image/CourtCanvas";
import type { CourtCanvas3DHandle, CourtView } from "@/components/court-image/CourtCanvas3D";
import {
  buildInitialLayout,
  courtCapacity,
  retileCourts,
  computeDesignAreas,
  buildPlotPolygon,
  buildMultiCutPolygon,
  surfaceFromProduct,
  newAnnotation,
  highlightZoneFromPreset,
  newBasketballHoop,
  newCricketPitch,
  newCustomLine,
  newCustomRect,
  newDugout,
  newFenceRect,
  newGoalPost,
  newHighlightZone,
  newRunOffHighlightZone,
  SPORT_LABEL,
  type CourtLayout,
  type Element,
  type Sport,
} from "@/lib/court-image/schema";
import { presetsForSports, type CourtPreset } from "@/lib/court-image/sport-standards";
import {
  ppeTileCount,
  isTiledSurface,
  isTurfSurface,
  isPvcSurface,
  turfRollMeters,
  pvcRollCount,
} from "@/lib/court-image/schema";
import {
  TURF_SHAPES,
  buildTurfShapePolygon,
  type TurfShapeKind,
} from "@/lib/court-image/turf-shapes";
import { useUserUnit } from "@/lib/units/useUserUnit";
import { toFeet, toUnit, FT_TO_M } from "@/lib/units";

// Konva is client-only. SSR will throw "window is undefined" if we let
// Next.js include react-konva in the server bundle.
const CourtCanvas = dynamic(() => import("@/components/court-image/CourtCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full bg-slate-100 text-sm text-slate-500">
      Loading canvas…
    </div>
  ),
});

// Three.js is also client-only — dynamic-imported so SSR doesn't try to
// touch window. We only mount the 3D component when the user toggles to
// the 3D preview in Step 3, so the chunk is only fetched on demand.
const CourtCanvas3D = dynamic(() => import("@/components/court-image/CourtCanvas3D"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full bg-slate-900 text-sm text-slate-300">
      Building 3D scene…
    </div>
  ),
});

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: { courtImageId: string; sent: boolean }) => void;
  // Pre-fill from inbox launch
  prefill?: {
    customerName?: string;
    contactPhone?: string;
    conversationId?: string;
  };
  // When set, the wizard loads an existing draft for editing rather than
  // starting fresh. Step 1 is skipped to jump straight into the canvas.
  editingId?: string;
};

// A single editable quotation line. `qty` is the area in sq.ft for
// area-priced rows or a piece count for per-piece rows; line total is
// always qty × rate. Seeded from the sport's rate sheet, then fully
// editable (and extendable with custom rows) in the Quotation step.
type QuoteLineItem = {
  id: string;
  name: string;
  desc: string;
  qty: number;
  unit: string;
  rate: number;
  gst: number;
  included: boolean;
};

let quoteLineSeq = 0;
function newQuoteLineId() {
  quoteLineSeq += 1;
  return `q-${quoteLineSeq}-${Math.floor(Math.random() * 1e6)}`;
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// When a single-sport plot is big enough for more than one court, offer to
// lay out extra courts (each editable). Hidden for multisport designs and for
// plots that only fit one court.
function MultiCourtBanner({
  layout,
  onSetCount,
}: {
  layout: CourtLayout;
  onSetCount: (count: number) => void;
}) {
  const primarySport = layout.primarySport ?? layout.sports[0];
  if (!primarySport || layout.sports.length !== 1) return null;
  const areas = computeDesignAreas(layout);
  const courtCount = Math.max(1, areas.courtCount);
  const capacity = courtCapacity(
    layout.plot.lengthFt,
    layout.plot.widthFt,
    primarySport as Sport,
  );
  if (capacity <= 1) return null;

  const label = SPORT_LABEL[primarySport] ?? cap(primarySport);
  const c0 = areas.courts[0];
  const sizeStr = c0
    ? `${Math.round(c0.lengthFt)} × ${Math.round(c0.widthFt)} ft`
    : "";
  // One button per count (1 = single). Capped so the row never runs away.
  const maxShown = Math.min(capacity, 8);
  const counts = Array.from({ length: maxShown }, (_, i) => i + 1);
  return (
    <div className="rounded-lg border border-wa-green/40 bg-wa-green/5 p-3 space-y-2">
      <div className="text-xs font-semibold text-wa-dark">
        This plot fits up to {capacity} {label} courts
        {sizeStr ? ` (${sizeStr} each)` : ""}
      </div>
      <div className="text-[11px] text-slate-600 leading-snug">
        Pick how many to lay out — they&apos;re tiled at regulation size across
        the plot, each fully editable (drag to reposition).
      </div>
      <div className="flex flex-wrap gap-1.5">
        {counts.map((n) => {
          const active = n === courtCount;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onSetCount(n)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md border transition ${
                active
                  ? "border-wa-green bg-wa-green text-white"
                  : "border-wa-green/40 bg-white text-wa-dark hover:bg-wa-green/10"
              }`}
            >
              {n} {n === 1 ? "court" : "courts"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Human-friendly default quotation number, e.g. "FIT-2026-4821".
function defaultQuoteNumber() {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `FIT-${year}-${rand}`;
}

// Live totals over the included line items (qty × rate, + GST%).
function computeQuoteTotals(items: QuoteLineItem[]) {
  let subtotal = 0;
  let gst = 0;
  for (const it of items) {
    if (!it.included) continue;
    const line = it.qty * it.rate;
    subtotal += line;
    gst += (line * it.gst) / 100;
  }
  return {
    subtotal: Math.round(subtotal),
    gst: Math.round(gst),
    grandTotal: Math.round(subtotal + gst),
  };
}

// Shape the wizard quote into the combined-PDF payload.
function buildQuotePayload(
  number: string,
  title: string,
  notes: string,
  items: QuoteLineItem[],
) {
  const t = computeQuoteTotals(items);
  return {
    number: number || defaultQuoteNumber(),
    title: title.trim() || null,
    notes: notes.trim() || null,
    items: items
      .filter((i) => i.included)
      .map((i) => ({
        name: i.name,
        desc: i.desc.trim() || null,
        qty: i.qty,
        unit: i.unit || null,
        rate: i.rate,
        gst: i.gst,
        total: Math.round(i.qty * i.rate),
      })),
    subtotal: t.subtotal,
    gst: t.gst,
    grandTotal: t.grandTotal,
  };
}

// Ready-made playing-surface colours for the dedicated "Court colour"
// picker. Sales can still type any custom hex. Applies to every sport that
// has a coloured hard court (i.e. all except football & cricket turf).
const COURT_COLORS: { name: string; hex: string }[] = [
  { name: "Sport Blue", hex: "#1E60A8" },
  { name: "Sky Blue", hex: "#3E7FB7" },
  { name: "Teal", hex: "#1E8A8A" },
  { name: "Court Green", hex: "#2F7D52" },
  { name: "Lawn Green", hex: "#4E9A5E" },
  { name: "Terracotta", hex: "#C0563B" },
  { name: "Court Red", hex: "#B83227" },
  { name: "Sand", hex: "#C97A4B" },
  { name: "Purple", hex: "#6C3FA4" },
  { name: "Slate Grey", hex: "#556070" },
];

// Collapsible sidebar section — a titled header (with a chevron) that
// expands/collapses its body. Used to categorise the Design panel so it
// isn't one long messy scroll.
// Small preview of a turf shape, generated from the same geometry the plot
// uses so the picker matches exactly what gets drawn.
function ShapeThumb({ kind }: { kind: TurfShapeKind }) {
  const w = 46;
  const h = 32;
  const poly = buildTurfShapePolygon(w, h, kind) ?? [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  // Flip y: plot origin is bottom-left, SVG origin is top-left.
  const d =
    poly
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${(h - p.y).toFixed(1)}`)
      .join(" ") + " Z";
  return (
    <svg viewBox={`-1 -1 ${w + 2} ${h + 2}`} width={w} height={h} aria-hidden>
      <path d={d} fill="#3f7a34" stroke="#2c5824" strokeWidth={1.5} />
    </svg>
  );
}

function CollapsibleSection({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-200 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-0.5 hover:text-slate-700"
      >
        <span>{title}</span>
        <span
          className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
      </button>
      {open && (
        <div className="pt-2 space-y-3">
          {hint && (
            <div className="text-[10.5px] text-slate-500 leading-snug">
              {hint}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// Sports the wizard can lay out. "multisport" is a base surface; others
// are stacked or substituted depending on combinations.
const SPORTS: Sport[] = [
  "football",
  "cricket",
  "basketball",
  "pickleball",
  "tennis",
  "badminton",
  "volleyball",
  "multisport",
];

export default function CourtImageWizard({
  open,
  onClose,
  onComplete,
  prefill,
  editingId,
}: Props) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 state
  const [customerName, setCustomerName] = useState(prefill?.customerName ?? "");
  const [lengthFt, setLengthFt] = useState(80);
  const [widthFt, setWidthFt] = useState(60);
  const [selectedSports, setSelectedSports] = useState<Sport[]>(["football"]);
  const [footballASide, setFootballASide] = useState<5 | 7 | 11 | null>(11);
  // Cricket turf strip — the two Fitoverse build sizes: 2 × 10 m or 2 × 20 m.
  const [cricketStripM, setCricketStripM] = useState<10 | 20>(20);
  const [cricketOrientation, setCricketOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [basketballHalfCourt, setBasketballHalfCourt] = useState(false);
  // Design mode: "standard" uses preset court dimensions per sport;
  // "custom" (future) lets sales design a plot with non-standard
  // shape (e.g. diagonal / irregular). Custom is a placeholder for
  // now — pick standard until the free-form editor lands.
  const [designMode, setDesignMode] = useState<"standard" | "custom">("standard");
  // Flooring / surface chosen in Step 1 so the canvas opens with the
  // customer's material already applied. Can still be changed on the
  // Design step's surface picker.
  const [initialSurface, setInitialSurface] = useState<"plain" | "ppe_tile_red" | "acrylic_blue" | "acrylic_green" | "turf_40mm" | "turf_50mm" | "pvc_sports">("plain");
  // Step 2 sidebar tab — Design (edit) vs Products / Equipment / TDS
  // (attach catalogue items to the design for the combined PDF).
  const [sidebarTab, setSidebarTab] = useState<"design" | AttachmentTab>(
    "design",
  );
  // Base work (sub-base) + linked flooring product chosen in Step 1.
  const [baseWork, setBaseWork] = useState<"" | "concrete" | "asphalt">("");
  const [flooringProduct, setFlooringProduct] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Step 2 state
  const [layout, setLayout] = useState<CourtLayout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Non-standard plot shape state. Corner cuts stack (multi-select),
  // diagonals and L-shapes are exclusive presets that replace the whole
  // polygon. `exclusiveShape === "rect"` with no active cuts = clean
  // rectangle plot.
  const [activeCorners, setActiveCorners] = useState<{
    tl: boolean; tr: boolean; bl: boolean; br: boolean;
  }>({ tl: false, tr: false, bl: false, br: false });
  const [exclusiveShape, setExclusiveShape] = useState<
    "rect" | "diag-top" | "diag-bot" | "l-tr" | "l-br"
  >("rect");
  // Curved / cricket-first turf shape (oval, Cricket-D, teardrop…). Mutually
  // exclusive with the corner-cut / diagonal presets above.
  const [turfShape, setTurfShape] = useState<TurfShapeKind | null>(null);

  // Step 3 state
  const [caption, setCaption] = useState("");
  const [contactPhone, setContactPhone] = useState(prefill?.contactPhone ?? "");
  const [pngDataUrl2D, setPngDataUrl2D] = useState<string | null>(null);
  const [pngDataUrl3D, setPngDataUrl3D] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(editingId ?? null);
  const [pngBlobUrl, setPngBlobUrl] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  // Which preview tab is currently visible in Step 3. The user can flip
  // between them freely to compare; what actually gets sent is controlled
  // by the `formats` checkboxes below — not by the active tab.
  const [previewMode, setPreviewMode] = useState<"2d" | "3d-image" | "3d-video">("2d");
  const [view3d, setView3d] = useState<CourtView>("orbit");
  const [preview3dSize, setPreview3dSize] = useState({ width: 800, height: 500 });
  const preview3dContainerRef = useRef<HTMLDivElement>(null);

  // What to send. Multiple checkboxes — each selected format ends up as
  // its own WhatsApp message to the customer in this order: 2D → 3D image
  // → 3D video. Caption is attached to the first.
  const [sendFormats, setSendFormats] = useState<{
    "2d": boolean;
    "3d-image": boolean;
    "3d-video": boolean;
  }>({ "2d": true, "3d-image": false, "3d-video": false });

  // 3D video state — populated when the user clicks "Generate video".
  // We keep the Blob around for upload + a data URL for inline preview.
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoDataUrl, setVideoDataUrl] = useState<string | null>(null);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  // Cached blob URLs of each format so PATCH only re-uploads what changed.
  const [uploadedUrls, setUploadedUrls] = useState<{
    "2d"?: string;
    "3d-image"?: string;
    "3d-video"?: string;
  }>({});

  // ── Step 3 (Quotation) state ──
  // Sales seeds a quote here — number, title, notes and fully editable
  // line items — which then flows into the combined PDF on the Send step.
  const [quoteEnabled, setQuoteEnabled] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState("");
  const [quoteTitle, setQuoteTitle] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");
  const [quoteItems, setQuoteItems] = useState<QuoteLineItem[]>([]);
  const [quoteSeeded, setQuoteSeeded] = useState(false);

  const canvasRef = useRef<CourtCanvasHandle | null>(null);
  const canvas3dRef = useRef<CourtCanvas3DHandle | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 540 });

  // Reset on open
  useEffect(() => {
    if (!open) return;
    if (editingId) {
      // Editing — fetch existing
      fetch(`/api/court-images/${editingId}`)
        .then((r) => r.json())
        .then((data) => {
          if (!data?.courtImage) return;
          setCustomerName(data.courtImage.customerName);
          setContactPhone(data.courtImage.contactPhone ?? "");
          setCaption(data.courtImage.caption ?? "");
          setLayout(data.courtImage.layout as CourtLayout);
          setPngBlobUrl(data.courtImage.imageUrl ?? null);
          setStep(2);
        })
        .catch(() => {
          toast.error("Could not load draft");
        });
    } else {
      setStep(1);
      setCustomerName(prefill?.customerName ?? "");
      setContactPhone(prefill?.contactPhone ?? "");
      setLengthFt(80);
      setWidthFt(60);
      setSelectedSports(["football"]);
      setCricketStripM(20);
      setCricketOrientation("horizontal");
      setFootballASide(11);
      setBasketballHalfCourt(false);
      setCaption("");
      setLayout(null);
      setSelectedId(null);
      setDraftId(null);
      setPngBlobUrl(null);
      setPngDataUrl2D(null);
      setPngDataUrl3D(null);
      setPreviewMode("2d");
      setQuoteEnabled(false);
      setQuoteNumber(defaultQuoteNumber());
      setQuoteTitle("");
      setQuoteNotes("");
      setQuoteItems([]);
      setQuoteSeeded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  // Track canvas container size for responsive Konva stage.
  useEffect(() => {
    if (step !== 2) return;
    const el = canvasContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [step]);

  // Keyboard shortcuts in the editor (Step 2).
  useEffect(() => {
    if (step !== 2) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeElement(selectedId);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedId]);

  // ─────────────────────────────────────────────
  //  Step transitions
  // ─────────────────────────────────────────────

  const step1Valid =
    customerName.trim().length > 0 &&
    lengthFt > 0 &&
    widthFt > 0 &&
    selectedSports.length > 0;

  function goStep2() {
    if (!step1Valid) {
      toast.error("Please fill all required fields");
      return;
    }
    const M_TO_FT = 3.28084;
    const initial = buildInitialLayout({
      plot: { lengthFt, widthFt },
      sports: selectedSports,
      config: {
        football: { aSide: footballASide ?? undefined },
        cricket: {
          // Turf strip: 2 m wide × 10 or 20 m long.
          pitchLengthFt: cricketStripM * M_TO_FT,
          pitchWidthFt: 2 * M_TO_FT,
          orientation: cricketOrientation,
        },
        basketball: { halfCourt: basketballHalfCourt },
      },
      title: customerName,
    });
    // Apply the flooring the user chose in Step 1. If nothing was
    // picked (initialSurface === "plain"), fall back to the legacy
    // solo-basketball default so the tile finish is applied without
    // an extra click on the design step.
    if (initialSurface !== "plain") {
      initial.style = { ...initial.style, surface: initialSurface };
    } else if (selectedSports.length === 1 && selectedSports[0] === "basketball") {
      initial.style = { ...initial.style, surface: "ppe_tile_red" };
    }
    // Grid overlay default: OFF for continuous-surface finishes
    // (acrylic, turf, PVC) because customers read the grid as a tile
    // pattern, and Fitoverse quotes those as roll / bulk deliverables
    // — not per tile. Stays ON for PPE tile (grid maps to real tile
    // edges) and Plain. Existing designs are untouched — this only
    // runs on fresh Step 1 → Step 2 hand-off.
    const continuousSurfaces = new Set([
      "acrylic_blue",
      "acrylic_green",
      "turf_40mm",
      "turf_50mm",
      "pvc_sports",
    ]);
    if (continuousSurfaces.has(initial.style.surface)) {
      initial.style = { ...initial.style, showGrid: false };
    }
    // Carry the Step 1 base work + linked flooring product onto the
    // layout so the design + combined PDF know them.
    initial.style = {
      ...initial.style,
      ...(baseWork ? { baseWork } : {}),
      ...(flooringProduct
        ? {
            flooringProductId: flooringProduct.id,
            flooringProductName: flooringProduct.name,
          }
        : {}),
    };
    setLayout(initial);
    setSelectedId(null);
    setStep(2);
  }

  async function goStep3() {
    if (!layout) return;
    const dataUrl = canvasRef.current?.toDataURL(2);
    if (!dataUrl) {
      toast.error("Could not render preview — try again");
      return;
    }
    setPngDataUrl2D(dataUrl);
    setPngDataUrl3D(null);
    setVideoBlob(null);
    setVideoDataUrl(null);
    setVideoProgress(0);
    setUploadedUrls({});
    setSendFormats({ "2d": true, "3d-image": false, "3d-video": false });
    setPreviewMode("2d");
    setStep(3);
  }

  // Seed the quotation line items from the primary sport's rate sheet,
  // sized to the plot. Fully editable afterwards. Returns silently if
  // there's no rate sheet for the sport (sales can still add rows).
  async function seedQuoteFromRates(force = false) {
    if (!layout) return;
    if (quoteItems.length > 0 && !force) return;
    const L = layout.plot.lengthFt;
    const W = layout.plot.widthFt;
    const supported = [
      "football",
      "basketball",
      "multisport",
      "pickleball",
      "tennis",
      "volleyball",
      "cricket",
      "badminton",
    ];
    const primary = layout.sports[0];
    const rateSport = supported.includes(primary) ? primary : "multisport";
    try {
      const r = await fetch(`/api/quotations/rates?sport=${rateSport}`);
      const j = await r.json();
      const items: QuoteLineItem[] = (j.items ?? []).map(
        (it: {
          id: string;
          name: string;
          description?: string;
          areaMode: string;
          defaultRate: number;
          gstPercent: number;
          optional?: boolean;
        }) => {
          const qty =
            it.areaMode === "perimeter"
              ? 2 * (L + W)
              : it.areaMode === "per_piece"
                ? 1
                : L * W;
          const unit = it.areaMode === "per_piece" ? "nos" : "sq.ft";
          return {
            id: newQuoteLineId(),
            name: it.name,
            // Seed the same default description the standalone Quotation
            // module uses, so it carries into the sent PDF (sales can still
            // edit or clear it per line).
            desc: it.description ?? "",
            qty,
            unit,
            rate: it.defaultRate,
            gst: it.gstPercent,
            included: !it.optional,
          };
        },
      );
      setQuoteItems(items);
    } catch {
      // No rate sheet — leave items empty; sales adds rows manually.
    }
  }

  // Entering the Quotation step for the first time: seed a starting
  // quote from the rate sheet so sales has a base to edit.
  useEffect(() => {
    if (step !== 3 || quoteSeeded) return;
    setQuoteSeeded(true);
    if (!quoteNumber) setQuoteNumber(defaultQuoteNumber());
    seedQuoteFromRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, quoteSeeded]);

  // Capture the current 3D scene as PNG. Called when the user switches to
  // 3D tab + clicks Refresh, and right before save/send if 3D is the
  // active mode (so we always send the latest framing).
  function capture3D() {
    const data = canvas3dRef.current?.toDataURL(2);
    if (data) setPngDataUrl3D(data);
    return data;
  }

  async function generate3DVideo() {
    if (generatingVideo) return;
    // Ensure the 3D scene is mounted (switch to the video tab + let it
    // settle) so the recorder handle is available even when the user
    // triggers Generate from the sidebar on another tab.
    if (!canvas3dRef.current) {
      setPreviewMode("3d-video");
      await new Promise((r) => setTimeout(r, 1400));
    }
    if (!canvas3dRef.current) {
      toast.error("Could not start the 3D scene — open the 3D video tab and retry");
      return;
    }
    setGeneratingVideo(true);
    setVideoProgress(0);
    try {
      const blob = await canvas3dRef.current.recordOrbitMP4({
        durationSec: 6,
        fps: 30,
        onProgress: (f) => setVideoProgress(f),
      });
      if (!blob) {
        toast.error("Could not record video — try Chrome or Edge");
        return;
      }
      setVideoBlob(blob);
      setVideoDataUrl(URL.createObjectURL(blob));
      // Reset the uploaded URL for video — next save will re-upload.
      setUploadedUrls((u) => ({ ...u, "3d-video": undefined }));
      toast.success("Video ready — toggle the checkbox to send it");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Video recording failed");
    } finally {
      setGeneratingVideo(false);
    }
  }

  // ─────────────────────────────────────────────
  //  Step 2 element ops
  // ─────────────────────────────────────────────

  function updateElement(id: string, patch: Partial<Element>) {
    setLayout((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === id ? ({ ...el, ...patch } as Element) : el
        ),
      };
    });
  }

  function removeElement(id: string) {
    setLayout((prev) => {
      if (!prev) return prev;
      return { ...prev, elements: prev.elements.filter((el) => el.id !== id) };
    });
    setSelectedId(null);
  }

  function duplicateElement(id: string) {
    setLayout((prev) => {
      if (!prev) return prev;
      const src = prev.elements.find((e) => e.id === id);
      if (!src) return prev;
      const copy: Element = {
        ...src,
        id: `${src.id}_copy_${Date.now().toString(36)}`,
        x: src.x + 8,
        y: src.y - 8,
        z: (src.z ?? 0) + 1,
      } as Element;
      return { ...prev, elements: [...prev.elements, copy] };
    });
  }

  function moveZ(id: string, dir: -1 | 1) {
    setLayout((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === id ? ({ ...el, z: (el.z ?? 0) + dir * 10 } as Element) : el
        ),
      };
    });
  }

  function addElement(
    kind:
      | "cricket"
      | "annotation"
      | "line"
      | "rect"
      | "goal-post"
      | "fence"
      | "dugout"
      | "hoop"
      | "highlight"
      | "highlight-runoff"
  ) {
    if (!layout) return;
    let newEl: Element;
    switch (kind) {
      case "cricket":
        newEl = newCricketPitch(layout.plot);
        break;
      case "annotation":
        newEl = newAnnotation(layout.plot, "Label");
        break;
      case "line":
        newEl = newCustomLine(layout.plot);
        break;
      case "rect":
        newEl = newCustomRect(layout.plot);
        break;
      case "goal-post":
        newEl = newGoalPost(layout.plot);
        break;
      case "fence":
        newEl = newFenceRect(layout.plot);
        break;
      case "dugout":
        newEl = newDugout(layout.plot);
        break;
      case "hoop":
        newEl = newBasketballHoop(layout.plot);
        break;
      case "highlight":
        newEl = newHighlightZone(layout.plot);
        break;
      case "highlight-runoff": {
        // Cut EVERY court out of the run-off highlight so only the ring
        // around each court gets tinted — not the courts themselves.
        const courts = layout.elements.filter(
          (e) =>
            e.type === "basketball-court" ||
            e.type === "football-field" ||
            e.type === "pickleball-court" ||
            e.type === "generic-court",
        ) as Array<Element & { x: number; y: number; width: number; height: number }>;
        newEl = newRunOffHighlightZone(
          layout.plot,
          courts.map((c) => ({
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
          })),
        );
        break;
      }
    }
    setLayout((prev) => (prev ? { ...prev, elements: [...prev.elements, newEl] } : prev));
    setSelectedId(newEl.id);
  }

  // Update the layout's polygon whenever the shape state changes.
  function recomputePolygon(
    corners: { tl: boolean; tr: boolean; bl: boolean; br: boolean },
    exclusive: "rect" | "diag-top" | "diag-bot" | "l-tr" | "l-br"
  ) {
    setLayout((l) => {
      if (!l) return l;
      const L = l.plot.lengthFt;
      const W = l.plot.widthFt;
      let poly: Array<{ x: number; y: number }> | undefined;
      if (exclusive === "diag-top")
        poly = buildPlotPolygon(L, W, { kind: "diagonal", edge: "top", slopePct: 20 });
      else if (exclusive === "diag-bot")
        poly = buildPlotPolygon(L, W, { kind: "diagonal", edge: "bottom", slopePct: 20 });
      else if (exclusive === "l-tr")
        poly = buildPlotPolygon(L, W, { kind: "l-shape", corner: "tr", wPct: 40, hPct: 40 });
      else if (exclusive === "l-br")
        poly = buildPlotPolygon(L, W, { kind: "l-shape", corner: "br", wPct: 40, hPct: 40 });
      else poly = buildMultiCutPolygon(L, W, { ...corners, sizePct: 25 });
      return { ...l, plot: { ...l.plot, polygon: poly } };
    });
  }

  function toggleCorner(corner: "tl" | "tr" | "bl" | "br") {
    const next = { ...activeCorners, [corner]: !activeCorners[corner] };
    setActiveCorners(next);
    setExclusiveShape("rect");
    setTurfShape(null);
    recomputePolygon(next, "rect");
  }

  // Rotate the primary sport element in the layout by the given degrees.
  // Applies to football / basketball / cricket-pitch / pickleball /
  // generic-court elements — the shapes that define the court itself.
  function rotatePrimaryCourt(deltaDeg: number) {
    setLayout((l) => {
      if (!l) return l;
      const courtTypes = new Set([
        "football-field",
        "basketball-court",
        "pickleball-court",
        "generic-court",
        "cricket-pitch",
      ]);
      return {
        ...l,
        elements: l.elements.map((el) =>
          courtTypes.has(el.type)
            ? { ...el, rotation: (el.rotation + deltaDeg) % 360 }
            : el
        ),
      };
    });
  }

  // Shrink the primary sport element(s) so they fit inside the plot
  // polygon's bounding envelope. For symmetric diagonals / corner cuts
  // we approximate a "safe rectangle" by clamping width × height to
  // the narrowest cross-section. Rectangle plots reset to the sport's
  // default playing-area size.
  function fitCourtToPlotShape() {
    setLayout((l) => {
      if (!l) return l;
      const poly = l.plot.polygon;
      // Rectangle plot — nothing to fit around.
      if (!poly || poly.length < 3) return l;
      const L = l.plot.lengthFt;
      const W = l.plot.widthFt;
      // Find the narrowest horizontal + vertical slice through the
      // polygon centre. That's a safe rectangle for the court element.
      // For symmetric shapes this is exact; for asymmetric it's a
      // reasonable lower bound.
      const cx = L / 2;
      const cy = W / 2;
      // Rasterise the polygon boundary and find the largest inscribed
      // axis-aligned rectangle centred on (cx, cy). Simple approach:
      // sample rays in +/- x and +/- y directions and use the shortest
      // distance to a polygon edge as the safe half-extent.
      function safeExtent(dirX: number, dirY: number): number {
        let t = 1e9;
        for (let i = 0; i < poly!.length; i++) {
          const p1 = poly![i];
          const p2 = poly![(i + 1) % poly!.length];
          // Ray from (cx,cy) in direction (dirX,dirY) intersect segment
          // p1→p2. Skip parallel segments.
          const rx = dirX;
          const ry = dirY;
          const sx = p2.x - p1.x;
          const sy = p2.y - p1.y;
          const denom = rx * sy - ry * sx;
          if (Math.abs(denom) < 1e-6) continue;
          const num1 = (p1.x - cx) * sy - (p1.y - cy) * sx;
          const num2 = (p1.x - cx) * ry - (p1.y - cy) * rx;
          const tt = num1 / denom;
          const uu = num2 / denom;
          if (tt >= 0 && uu >= 0 && uu <= 1 && tt < t) t = tt;
        }
        return t < 1e8 ? t : 0;
      }
      const halfW = Math.min(safeExtent(1, 0), safeExtent(-1, 0));
      const halfH = Math.min(safeExtent(0, 1), safeExtent(0, -1));
      const targetW = Math.max(halfW * 2 - 2, 10);
      const targetH = Math.max(halfH * 2 - 2, 10);
      const courtTypes = new Set([
        "football-field",
        "basketball-court",
        "pickleball-court",
        "generic-court",
      ]);
      // First pass — compute new dimensions for each court element so the
      // Net element (second pass) can size to the resized court's width.
      const resizedById: Record<string, { w: number; h: number }> = {};
      const midElements = l.elements.map((el) => {
        // For rotated courts (90° or 270°), swap the target axes so
        // the court width still maps to the polygon's short side.
        const rot = ((el.rotation % 360) + 360) % 360;
        const swap = rot === 90 || rot === 270;
        const w = swap ? targetH : targetW;
        const h = swap ? targetW : targetH;
        if (courtTypes.has(el.type)) {
          const asAny = el as { width?: number; height?: number };
          if (asAny.width == null || asAny.height == null) return el;
          const ratio = asAny.width / asAny.height;
          let nw = w;
          let nh = w / ratio;
          if (nh > h) {
            nh = h;
            nw = h * ratio;
          }
          resizedById[el.id] = { w: nw, h: nh };
          return { ...el, x: cx, y: cy, width: nw, height: nh } as typeof el;
        }
        // Cricket pitch has pitchLengthFt / pitchWidthFt instead of
        // width / height. Keep its native aspect ratio.
        if (el.type === "cricket-pitch") {
          const asAny = el as { pitchLengthFt: number; pitchWidthFt: number };
          const ratio = asAny.pitchLengthFt / asAny.pitchWidthFt;
          let nl = w;
          let nw2 = w / ratio;
          if (nw2 > h) {
            nw2 = h;
            nl = h * ratio;
          }
          return {
            ...el,
            x: cx,
            y: cy,
            pitchLengthFt: nl,
            pitchWidthFt: nw2,
          } as typeof el;
        }
        return el;
      });
      // Second pass — resize the Net element to match the resized court
      // and re-centre it. The net's widthFt tracks the court's SHORT
      // side (h) because we rotate the net 90° at layout time.
      return {
        ...l,
        elements: midElements.map((el) => {
          if (el.type !== "net") return el;
          // Nets typically live near a court's centre; snap them to
          // the plot centre and match the last resized court's h.
          const anyResized = Object.values(resizedById)[0];
          if (!anyResized) return { ...el, x: cx, y: cy };
          return {
            ...el,
            x: cx,
            y: cy,
            widthFt: anyResized.h,
          } as typeof el;
        }),
      };
    });
  }

  function setExclusive(shape: "rect" | "diag-top" | "diag-bot" | "l-tr" | "l-br") {
    // Exclusive shapes clear the corner cuts — they replace the whole
    // polygon rather than compose.
    const clearedCorners = { tl: false, tr: false, bl: false, br: false };
    setActiveCorners(clearedCorners);
    setExclusiveShape(shape);
    setTurfShape(null);
    recomputePolygon(clearedCorners, shape);
  }

  // Pick a curved / cricket-first turf shape. The polygon itself is generated
  // by the effect below (also on plot-dimension change).
  function pickTurfShape(kind: TurfShapeKind) {
    setActiveCorners({ tl: false, tr: false, bl: false, br: false });
    setExclusiveShape("rect");
    setTurfShape(kind);
  }

  // Regenerate the turf-shape polygon whenever the shape or the plot
  // dimensions change (the polygon is stored in absolute plot feet).
  useEffect(() => {
    if (!turfShape) return;
    setLayout((l) =>
      l
        ? {
            ...l,
            plot: {
              ...l.plot,
              polygon: buildTurfShapePolygon(
                l.plot.lengthFt,
                l.plot.widthFt,
                turfShape,
              ),
            },
          }
        : l,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turfShape, layout?.plot.lengthFt, layout?.plot.widthFt]);

  function toggleWatermark() {
    setLayout((prev) => {
      if (!prev) return prev;
      const currentlyOn = !!prev.style.watermarkUrl;
      return {
        ...prev,
        style: {
          ...prev.style,
          watermarkUrl: currentlyOn ? undefined : "/quotation-assets/image1.png",
        },
      };
    });
  }

  // ─────────────────────────────────────────────
  //  Save + send (Step 3)
  // ─────────────────────────────────────────────

  // Resize observer for the 3D preview container in Step 3 — runs whenever
  // either 3D tab is active (image OR video), since both mount the same
  // Three.js renderer. Send is step 4 (Sports→Design→Quotation→Send); this
  // was still gated on step 3 from before the Quotation step existed, so the
  // 3D canvas never resized to its container and rendered at a fixed 800×500
  // that didn't fit the preview. Also re-measure on the next frame so the
  // container has its real size after the tab switch.
  useEffect(() => {
    if (step !== 4) return;
    if (previewMode !== "3d-image" && previewMode !== "3d-video") return;
    const el = preview3dContainerRef.current;
    if (!el) return;
    const measure = () =>
      setPreview3dSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const raf = requestAnimationFrame(measure);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [step, previewMode]);

  // Upload data-URL PNG to /api/media/upload (which writes to Vercel Blob).
  async function uploadPng(dataUrl: string): Promise<string> {
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    form.append(
      "file",
      new File([blob], `court-design-${Date.now()}.png`, { type: "image/png" })
    );
    const res = await fetch("/api/media/upload", { method: "POST", body: form });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error ?? "Image upload failed");
    }
    const data = await res.json();
    return data.media.url as string;
  }

  // Upload an MP4 video blob to the same endpoint. The media API auto-
  // categorises by mimeType so video bookkeeping mirrors images.
  async function uploadVideo(blob: Blob): Promise<string> {
    const form = new FormData();
    form.append(
      "file",
      new File([blob], `court-design-orbit-${Date.now()}.mp4`, { type: "video/mp4" })
    );
    const res = await fetch("/api/media/upload", { method: "POST", body: form });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error ?? "Video upload failed");
    }
    const data = await res.json();
    return data.media.url as string;
  }

  // Uploads each picked-and-not-yet-uploaded format. Returns the URL map.
  async function uploadSelectedFormats(): Promise<{
    "2d"?: string;
    "3d-image"?: string;
    "3d-video"?: string;
  }> {
    const next: typeof uploadedUrls = { ...uploadedUrls };

    if (sendFormats["2d"] && !next["2d"]) {
      if (!pngDataUrl2D) throw new Error("2D preview missing — re-open the wizard");
      next["2d"] = await uploadPng(pngDataUrl2D);
    }
    if (sendFormats["3d-image"]) {
      const data = capture3D() ?? pngDataUrl3D;
      if (!data) throw new Error("3D image preview missing — open the 3D tab first");
      next["3d-image"] = await uploadPng(data);
    }
    if (sendFormats["3d-video"]) {
      if (!videoBlob)
        throw new Error("3D video not generated — click Generate first");
      if (!next["3d-video"]) {
        next["3d-video"] = await uploadVideo(videoBlob);
      }
    }
    setUploadedUrls(next);
    return next;
  }

  async function saveDraft(): Promise<{
    id: string;
    urls: { "2d"?: string; "3d-image"?: string; "3d-video"?: string };
  } | null> {
    if (!layout) return null;
    const anySelected =
      sendFormats["2d"] || sendFormats["3d-image"] || sendFormats["3d-video"];
    if (!anySelected) {
      toast.error("Pick at least one format to send");
      return null;
    }
    setSavingDraft(true);
    try {
      const urls = await uploadSelectedFormats();
      // The primary imageUrl is whichever image was uploaded first — used
      // for inbox-mirror display + list-page thumbnail. Video can't act as
      // the thumbnail, so we prefer image URLs.
      const imageUrl =
        urls["2d"] ?? urls["3d-image"] ?? null;
      setPngBlobUrl(imageUrl ?? null);

      const payload = {
        customerName,
        layout,
        imageUrl,
        image2dUrl: urls["2d"] ?? null,
        image3dUrl: urls["3d-image"] ?? null,
        video3dUrl: urls["3d-video"] ?? null,
        caption: caption.trim() || null,
        contactPhone: contactPhone.trim() || null,
        conversationId: prefill?.conversationId ?? null,
      };

      if (draftId) {
        const res = await fetch(`/api/court-images/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error ?? "Save failed");
        }
        return { id: draftId, urls };
      } else {
        const res = await fetch(`/api/court-images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error ?? "Save failed");
        }
        const data = await res.json();
        setDraftId(data.courtImage.id);
        return { id: data.courtImage.id, urls };
      }
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSaveDraft() {
    try {
      const result = await saveDraft();
      if (result) {
        toast.success("Draft saved");
        onComplete({ courtImageId: result.id, sent: false });
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function handleSend() {
    if (!contactPhone.trim()) {
      toast.error("Enter a customer phone first");
      return;
    }
    const formats = (
      ["2d", "3d-image", "3d-video"] as const
    ).filter((f) => sendFormats[f]);
    if (formats.length === 0) {
      toast.error("Pick at least one format to send");
      return;
    }
    setSending(true);
    try {
      const result = await saveDraft();
      if (!result) throw new Error("Could not save before sending");
      const res = await fetch(`/api/court-images/${result.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formats }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message ?? e.error ?? "Send failed");
      }
      toast.success(
        `${formats.length === 1 ? "Design" : `${formats.length} formats`} sent to ${contactPhone}`
      );
      onComplete({ courtImageId: result.id, sent: true });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  // ─────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────

  const selectedElement = useMemo(
    () => layout?.elements.find((e) => e.id === selectedId) ?? null,
    [layout, selectedId]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-stretch justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] flex flex-col overflow-hidden">
        {/* Header — title + step indicator + close */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="font-semibold text-slate-900">Court Designer</div>
            <StepDots current={step} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md hover:bg-slate-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {step === 1 && (
            <Step1
              customerName={customerName}
              setCustomerName={setCustomerName}
              lengthFt={lengthFt}
              setLengthFt={setLengthFt}
              widthFt={widthFt}
              setWidthFt={setWidthFt}
              selectedSports={selectedSports}
              setSelectedSports={setSelectedSports}
              footballASide={footballASide}
              setFootballASide={setFootballASide}
              cricketStripM={cricketStripM}
              setCricketStripM={setCricketStripM}
              cricketOrientation={cricketOrientation}
              setCricketOrientation={setCricketOrientation}
              basketballHalfCourt={basketballHalfCourt}
              setBasketballHalfCourt={setBasketballHalfCourt}
              designMode={designMode}
              setDesignMode={setDesignMode}
              initialSurface={initialSurface}
              setInitialSurface={setInitialSurface}
              baseWork={baseWork}
              setBaseWork={setBaseWork}
              flooringProduct={flooringProduct}
              setFlooringProduct={setFlooringProduct}
            />
          )}

          {step === 2 && layout && (
            // Stack vertically on mobile so the canvas gets the full width
            // and dimension labels render at readable size. Desktop keeps
            // the side-by-side layers panel + canvas split.
            <div className="flex flex-col md:flex-row h-full">
              {/* Left panel — layers + inspector + add. Shown below the
                  canvas on mobile so the visual editor stays primary. */}
              <div className="order-2 md:order-1 w-full md:w-72 md:shrink-0 md:border-r border-slate-200 bg-slate-50 overflow-y-auto p-4 space-y-4 max-h-[45vh] md:max-h-none">
                {/* Sidebar tabs — Design (edit the court) vs attach
                    catalogue items (Products / Equipment) that go into the
                    combined PDF. Each product/equipment now carries its own
                    TDS, so attaching it auto-includes the spec sheet — no
                    separate TDS tab. */}
                <div className="grid grid-cols-3 gap-1 bg-slate-100 rounded-lg p-1 sticky top-0 z-10">
                  {(
                    [
                      { id: "design", label: "Design" },
                      { id: "products", label: "Products" },
                      { id: "equipment", label: "Equip." },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSidebarTab(t.id)}
                      className={`px-1 py-1.5 text-[11px] font-medium rounded-md transition ${
                        sidebarTab === t.id
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {sidebarTab !== "design" && (
                  <DesignAttachments
                    tab={sidebarTab}
                    sports={layout.sports}
                    attachments={
                      layout.attachments ?? {
                        productIds: [],
                        equipmentIds: [],
                        tdsIds: [],
                      }
                    }
                    onChange={(next: Attachments) =>
                      setLayout((l) => (l ? { ...l, attachments: next } : l))
                    }
                    onFlooringPicked={(product) => {
                      const inferred = surfaceFromProduct(
                        product.category,
                        product.name,
                      );
                      setLayout((l) =>
                        l
                          ? {
                              ...l,
                              style: {
                                ...l.style,
                                ...(inferred !== "plain"
                                  ? { surface: inferred }
                                  : {}),
                                flooringProductId: product.id,
                                flooringProductName: product.name,
                                flooringProductImageUrl:
                                  product.heroImageUrl ?? undefined,
                              },
                            }
                          : l,
                      );
                    }}
                  />
                )}

                {sidebarTab === "design" && (
                  <>
                {/* Offer to tile extra courts when the plot is big enough. */}
                <MultiCourtBanner
                  layout={layout}
                  onSetCount={(count) =>
                    setLayout((l) => (l ? retileCourts(l, count) : l))
                  }
                />
                {/* When a highlight zone is selected, surface the colour
                    prompt right at the top so sales sees "what colour?"
                    immediately after picking an area. */}
                {selectedElement?.type === "highlight-zone" && (
                  <HighlightColorPrompt
                    fill={selectedElement.fill}
                    onColor={(rgba) =>
                      updateElement(selectedElement.id, { fill: rgba })
                    }
                  />
                )}
                <LayerList
                  elements={layout.elements}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onToggleVisible={(id) => {
                    const el = layout.elements.find((e) => e.id === id);
                    if (el) updateElement(id, { visible: el.visible === false });
                  }}
                  onToggleLocked={(id) => {
                    const el = layout.elements.find((e) => e.id === id);
                    if (el) updateElement(id, { locked: !el.locked });
                  }}
                />

                {/* Highlights — the "colour just one area" tools. Kept
                    open + near the top because sales reaches for these a
                    lot (this is the per-area counterpart to the whole-court
                    colour under Colour & surface). */}
                <CollapsibleSection
                  title="Highlights (colour one area)"
                  defaultOpen
                  hint="Drop a coloured rectangle you drag, resize, and recolour from the inspector — to fill a basketball key, service box, pickleball kitchen, etc. Renders UNDER the markings so lines stay legible."
                >
                  <button
                    type="button"
                    onClick={() => addElement("highlight")}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-medium text-amber-900 transition"
                  >
                    <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" />
                    <span className="flex-1 text-left">+ Highlight zone</span>
                    <span className="text-[10px] text-amber-700">colour · drag · resize</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => addElement("highlight-runoff")}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-medium text-amber-900 transition"
                  >
                    <span className="inline-block w-3 h-3 rounded-sm bg-amber-500 opacity-60" />
                    <span className="flex-1 text-left">+ Highlight run-off area</span>
                    <span className="text-[10px] text-amber-700">outside the court</span>
                  </button>
                </CollapsibleSection>

                {/* Add element — objects dropped onto the plot. */}
                <CollapsibleSection title="Add element">
                  <div className="grid grid-cols-2 gap-1.5">
                    <AddBtn label="Cricket pitch" onClick={() => addElement("cricket")} />
                    <AddBtn label="Goal post" onClick={() => addElement("goal-post")} />
                    <AddBtn label="Basketball hoop" onClick={() => addElement("hoop")} />
                    <AddBtn label="Fence outline" onClick={() => addElement("fence")} />
                    <AddBtn label="Dugout" onClick={() => addElement("dugout")} />
                    <AddBtn label="Label" onClick={() => addElement("annotation")} />
                    <AddBtn label="Line / arrow" onClick={() => addElement("line")} />
                    <AddBtn label="Rectangle" onClick={() => addElement("rect")} />
                  </div>
                </CollapsibleSection>

                {/* Plot shape — only shown in non-standard (custom) mode.
                    Corner cuts stack (checkboxes): sales can click Cut
                    top-left AND Cut bottom-right to get both notches.
                    Diagonal and L-shape presets are exclusive — they
                    replace the whole polygon. Court elements are
                    automatically clipped to the polygon so they don't
                    spill into the cut zones. */}
                {designMode === "custom" && (
                  <CollapsibleSection title="Plot shape">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      Turf shapes (curved · cricket-first)
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {TURF_SHAPES.map((s) => (
                        <button
                          key={s.kind}
                          type="button"
                          onClick={() => pickTurfShape(s.kind)}
                          title={s.blurb}
                          className={`flex flex-col items-center gap-0.5 px-1 py-1.5 rounded border transition ${
                            turfShape === s.kind
                              ? "bg-wa-green/10 border-wa-green ring-1 ring-wa-green/40"
                              : "bg-white border-slate-300 hover:border-slate-400"
                          }`}
                        >
                          <ShapeThumb kind={s.kind} />
                          <span className="text-[9px] leading-tight text-slate-700 text-center">
                            {s.label}
                          </span>
                          <span className="text-[8px] text-slate-400">{s.utilPct}%</span>
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-slate-500 leading-relaxed">
                      Curved shapes keep the cricket pitch on the long axis. The
                      % is indicative turf utilisation; the design shows the exact
                      area. Or use the straight-edge presets below.
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-2">
                      Corner cuts (multi-select)
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { key: "tl", label: "Cut top-left" },
                          { key: "tr", label: "Cut top-right" },
                          { key: "bl", label: "Cut bottom-left" },
                          { key: "br", label: "Cut bottom-right" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => toggleCorner(opt.key)}
                          className={`px-2 py-1.5 text-[11px] rounded border transition ${
                            activeCorners[opt.key] && exclusiveShape === "rect"
                              ? "bg-wa-green text-white border-wa-green"
                              : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-2">
                      Or pick one shape preset
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { key: "rect", label: "Rectangle (reset)" },
                          { key: "diag-top", label: "Diagonal top" },
                          { key: "diag-bot", label: "Diagonal bottom" },
                          { key: "l-tr", label: "L-shape TR" },
                          { key: "l-br", label: "L-shape BR" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setExclusive(opt.key)}
                          className={`px-2 py-1.5 text-[11px] rounded border transition ${
                            exclusiveShape === opt.key &&
                            !(activeCorners.tl || activeCorners.tr || activeCorners.bl || activeCorners.br)
                              ? "bg-wa-green text-white border-wa-green"
                              : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-slate-500 leading-relaxed">
                      Corner cuts / diagonals default to 25 % of the plot
                      edge. L-shape notches are 40 % × 40 %. Elements
                      that spill past the polygon are automatically
                      clipped.
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-3">
                      Court adjustments
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => rotatePrimaryCourt(90)}
                        className="px-2 py-1.5 text-[11px] rounded border bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                      >
                        Rotate 90°
                      </button>
                      <button
                        type="button"
                        onClick={() => rotatePrimaryCourt(45)}
                        className="px-2 py-1.5 text-[11px] rounded border bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                      >
                        Rotate 45°
                      </button>
                      <button
                        type="button"
                        onClick={fitCourtToPlotShape}
                        className="col-span-2 px-2 py-1.5 text-[11px] rounded border bg-wa-green/10 text-wa-dark border-wa-green hover:bg-wa-green/20"
                      >
                        Fit court to plot shape
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500 leading-relaxed">
                      Rotate the court to any angle, then click Fit to
                      auto-shrink it inside the polygon (preserves the
                      sport's aspect ratio).
                    </div>
                  </CollapsibleSection>
                )}

                {/* Court colour — the dedicated, easy control for the
                    playing-surface colour. Sets surfaceColorOverride, which
                    both the 2D plan and the 3D render honour. Hidden for pure
                    turf sports (football / cricket) — those use the grass
                    colour instead. */}
                {layout.sports.some(
                  (s) => s !== "football" && s !== "cricket",
                ) && (
                  <CollapsibleSection
                    title="Court colour"
                    defaultOpen
                    hint="The playing-surface colour, shown in both the 2D plan and the 3D render. Pick a preset or type any hex. Football & cricket use the grass colour instead."
                  >
                    <div className="space-y-3">
                      <div className="grid grid-cols-5 gap-2">
                        {COURT_COLORS.map((c) => {
                          const active =
                            (
                              layout.style.surfaceColorOverride ?? ""
                            ).toLowerCase() === c.hex.toLowerCase();
                          return (
                            <button
                              key={c.hex}
                              type="button"
                              title={c.name}
                              onClick={() =>
                                setLayout((l) =>
                                  l
                                    ? {
                                        ...l,
                                        style: {
                                          ...l.style,
                                          surfaceColorOverride: c.hex,
                                        },
                                      }
                                    : l,
                                )
                              }
                              className={`h-9 rounded-md border-2 transition ${
                                active
                                  ? "border-wa-green ring-2 ring-wa-green/40"
                                  : "border-slate-200 hover:border-slate-400"
                              }`}
                              style={{ backgroundColor: c.hex }}
                            />
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={layout.style.surfaceColorOverride ?? "#1E60A8"}
                          onChange={(e) =>
                            setLayout((l) =>
                              l
                                ? {
                                    ...l,
                                    style: {
                                      ...l.style,
                                      surfaceColorOverride: e.target.value,
                                    },
                                  }
                                : l,
                            )
                          }
                          className="w-9 h-9 rounded border border-slate-300 cursor-pointer bg-white shrink-0"
                          title="Custom colour"
                        />
                        <input
                          type="text"
                          value={layout.style.surfaceColorOverride ?? ""}
                          placeholder="Custom hex e.g. #1E60A8"
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            setLayout((l) =>
                              l
                                ? {
                                    ...l,
                                    style: {
                                      ...l.style,
                                      surfaceColorOverride:
                                        v.length === 0 ? undefined : v,
                                    },
                                  }
                                : l,
                            );
                          }}
                          className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                        />
                        {layout.style.surfaceColorOverride && (
                          <button
                            type="button"
                            onClick={() =>
                              setLayout((l) =>
                                l
                                  ? {
                                      ...l,
                                      style: {
                                        ...l.style,
                                        surfaceColorOverride: undefined,
                                      },
                                    }
                                  : l,
                              )
                            }
                            className="text-[10.5px] text-slate-500 hover:text-slate-700 underline whitespace-nowrap shrink-0"
                            title="Use the finish's default colour"
                          >
                            Default
                          </button>
                        )}
                      </div>
                      <div className="text-[10.5px] text-slate-500 leading-snug">
                        Applies to the whole playing surface. To colour just one
                        area (a key, service box, kitchen), use “+ Highlight
                        zone” under Highlights above.
                      </div>
                    </div>
                  </CollapsibleSection>
                )}

                {/* Surface & colour — ONE collapsible category: the
                    material (surface finish), the ground/court colour, and
                    the run-off convention all live together so appearance
                    isn't split across the panel. Per-area colouring is the
                    separate Highlights section above. */}
                <CollapsibleSection
                  title="Surface finish & run-off"
                  defaultOpen
                  hint="The material finish, the ground/base colour and the run-off convention. The main court colour is now its own “Court colour” section above; per-area colours are under Highlights."
                >
                  <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Surface finish
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { id: "plain", label: "Plain", group: "any" },
                        { id: "ppe_tile_red", label: "PPE tile — Red", group: "hard" },
                        { id: "acrylic_blue", label: "Acrylic — Blue", group: "hard" },
                        { id: "acrylic_green", label: "Acrylic — Green", group: "hard" },
                        { id: "turf_40mm", label: "Turf — 40 mm", group: "turf" },
                        { id: "turf_50mm", label: "Turf — 50 mm", group: "turf" },
                      ] as const
                    )
                      .filter((opt) => {
                        // Only offer finishes that suit the sport: turf for
                        // football/cricket, hard-court (PPE / acrylic) for the
                        // court sports, everything for multisport. "Plain"
                        // always shows.
                        if (opt.group === "any") return true;
                        const s = layout.sports;
                        const turf =
                          s.includes("multisport") ||
                          s.some((x) => x === "football" || x === "cricket");
                        const hard =
                          s.includes("multisport") ||
                          s.some(
                            (x) =>
                              !["football", "cricket", "multisport"].includes(x),
                          );
                        return opt.group === "turf" ? turf : hard;
                      })
                      .map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setLayout((l) =>
                            l ? { ...l, style: { ...l.style, surface: opt.id } } : l
                          )
                        }
                        className={`px-3 py-1.5 text-xs rounded-md border transition ${
                          layout.style.surface === opt.id
                            ? "bg-wa-green text-white border-wa-green"
                            : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {isTiledSurface(layout.style.surface) && (
                    <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2">
                      {(() => {
                        const c = ppeTileCount(
                          layout.plot.lengthFt,
                          layout.plot.widthFt
                        );
                        return (
                          <>
                            <div className="font-medium">
                              {c.total.toLocaleString("en-IN")} tiles required
                            </div>
                            <div className="text-slate-500">
                              {c.perLength} × {c.perWidth} at 30 × 30 cm each
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  {(layout.style.surface === "acrylic_blue" ||
                    layout.style.surface === "acrylic_green") && (
                    <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2">
                      <div className="font-medium">
                        Acrylic hard-court coating
                      </div>
                      <div className="text-slate-500">
                        Applied over a PCC slab · quoted by sq.ft (
                        {(
                          layout.plot.lengthFt * layout.plot.widthFt
                        ).toLocaleString("en-IN")}{" "}
                        sq.ft plot)
                      </div>
                    </div>
                  )}
                  {isTurfSurface(layout.style.surface) && (
                    <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2">
                      {(() => {
                        const r = turfRollMeters(
                          layout.plot.lengthFt,
                          layout.plot.widthFt
                        );
                        return (
                          <>
                            <div className="font-medium">
                              {r.totalMeters.toLocaleString("en-IN")} m turf roll required
                            </div>
                            <div className="text-slate-500">
                              Light {r.lightMeters.toLocaleString("en-IN")} m + Dark {r.darkMeters.toLocaleString("en-IN")} m · {r.stripes} stripes · 2 m rolls
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  {isPvcSurface(layout.style.surface) && (
                    <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2">
                      {(() => {
                        const p = pvcRollCount(
                          layout.plot.lengthFt,
                          layout.plot.widthFt
                        );
                        return (
                          <>
                            <div className="font-medium">
                              {p.totalSqM.toLocaleString("en-IN")} m² PVC required
                            </div>
                            <div className="text-slate-500">
                              {p.rolls} rolls · 1.8 m wide × 20 m long · {p.runningMeters.toLocaleString("en-IN")} running m
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  </div>

                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Ground finish
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: undefined, label: "Sand (default)" },
                          { id: "concrete", label: "Concrete grey" },
                          { id: "grass", label: "Grass green" },
                          { id: "white", label: "White" },
                        ] as const
                      ).map((opt) => {
                        const active =
                          (layout.style.groundFinish ?? undefined) === opt.id;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() =>
                              setLayout((l) =>
                                l
                                  ? {
                                      ...l,
                                      style: {
                                        ...l.style,
                                        groundFinish: opt.id,
                                        // Clear any custom override
                                        // when a preset is chosen so
                                        // the preset actually applies.
                                        groundColorOverride: undefined,
                                      },
                                    }
                                  : l,
                              )
                            }
                            className={`px-3 py-1.5 text-xs rounded-md border transition ${
                              active
                                ? "bg-wa-green text-white border-wa-green"
                                : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {/* Custom hex — override the preset with an exact
                        colour when the customer wants a specific
                        outdoor tone. */}
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="color"
                        value={layout.style.groundColorOverride ?? "#9c845b"}
                        onChange={(e) =>
                          setLayout((l) =>
                            l
                              ? {
                                  ...l,
                                  style: {
                                    ...l.style,
                                    groundColorOverride: e.target.value,
                                  },
                                }
                              : l,
                          )
                        }
                        className="w-8 h-8 rounded border border-slate-300 cursor-pointer bg-white"
                        title="Ground colour override"
                      />
                      <input
                        type="text"
                        value={layout.style.groundColorOverride ?? ""}
                        placeholder="Custom hex (any colour)"
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          setLayout((l) =>
                            l
                              ? {
                                  ...l,
                                  style: {
                                    ...l.style,
                                    groundColorOverride:
                                      v.length === 0 ? undefined : v,
                                  },
                                }
                              : l,
                          );
                        }}
                        className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                      />
                    </div>
                  </div>

                  {/* Court playing-surface colour now lives in its own
                      dedicated "Court colour" section above (presets + custom
                      hex). This section keeps the material finish, the ground
                      colour and the run-off convention. */}

                  <div>
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Run-off zone tone
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: "off", label: "Off (single tone)" },
                          { id: "subtle", label: "Subtle" },
                          { id: "distinct", label: "Distinct" },
                        ] as const
                      ).map((opt) => {
                        const current = layout.style.runOffTone ?? "off";
                        const active = current === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() =>
                              setLayout((l) =>
                                l
                                  ? {
                                      ...l,
                                      style: {
                                        ...l.style,
                                        runOffTone: opt.id,
                                      },
                                    }
                                  : l,
                              )
                            }
                            className={`px-3 py-1.5 text-xs rounded-md border transition ${
                              active
                                ? "bg-wa-green text-white border-wa-green"
                                : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-[10.5px] text-slate-500 mt-1.5 leading-snug">
                      Splits the plot fill into a playing area (full colour)
                      and a run-off zone (darker shade of the same colour).
                      Useful when showing customers the FIBA / FIFA run-off
                      convention around the sport court.
                    </div>
                  </div>

                  {/* Optional colour override for the run-off zone. Only
                      offered when a run-off tone is active. Sales and
                      admin can paint the run-off in a specific hex to
                      match a real construction photo or brand palette. */}
                  {layout.style.runOffTone &&
                    layout.style.runOffTone !== "off" && (
                      <div>
                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                          Run-off colour override
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={
                              layout.style.runOffColorOverride ?? "#264d80"
                            }
                            onChange={(e) =>
                              setLayout((l) =>
                                l
                                  ? {
                                      ...l,
                                      style: {
                                        ...l.style,
                                        runOffColorOverride: e.target.value,
                                      },
                                    }
                                  : l,
                              )
                            }
                            className="w-9 h-9 rounded border border-slate-300 cursor-pointer bg-white"
                            title="Pick a colour"
                          />
                          <input
                            type="text"
                            value={layout.style.runOffColorOverride ?? ""}
                            onChange={(e) => {
                              const v = e.target.value.trim();
                              setLayout((l) =>
                                l
                                  ? {
                                      ...l,
                                      style: {
                                        ...l.style,
                                        runOffColorOverride:
                                          v.length === 0 ? undefined : v,
                                      },
                                    }
                                  : l,
                              );
                            }}
                            placeholder="Auto (derived from surface)"
                            className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                          />
                          {layout.style.runOffColorOverride && (
                            <button
                              type="button"
                              onClick={() =>
                                setLayout((l) =>
                                  l
                                    ? {
                                        ...l,
                                        style: {
                                          ...l.style,
                                          runOffColorOverride: undefined,
                                        },
                                      }
                                    : l,
                                )
                              }
                              className="text-[11px] text-slate-500 hover:text-slate-700 underline"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        <div className="text-[10.5px] text-slate-500 mt-1.5">
                          Leave blank to use the auto-shade from Surface
                          finish. Any hex value overrides it.
                        </div>
                      </div>
                    )}
                </CollapsibleSection>

                {/* Primary sport dropdown — only shown on multi-sport
                    plots. Drives z-order (primary drawn on top) so
                    sales can flip which court reads as the hero. The
                    zone colours themselves come from
                    MULTISPORT_ZONE_COLOR applied at layout build. */}
                {layout.sports.length >= 2 && (
                  <CollapsibleSection title="Primary sport" defaultOpen>
                    <select
                      value={layout.primarySport ?? layout.sports[0]}
                      onChange={(e) => {
                        const next = e.target.value as Sport;
                        setLayout((l) => {
                          if (!l) return l;
                          // Sort elements so the primary sport's court
                          // renders on top of the others. Non-court
                          // elements keep their relative order.
                          const isCourt = (t: string) =>
                            t === "basketball-court" ||
                            t === "football-field" ||
                            t === "pickleball-court" ||
                            t === "generic-court" ||
                            t === "cricket-pitch";
                          const sportFor = (el: Element): Sport | null => {
                            if (el.type === "basketball-court")
                              return "basketball";
                            if (el.type === "football-field")
                              return "football";
                            if (el.type === "pickleball-court")
                              return "pickleball";
                            if (el.type === "cricket-pitch")
                              return "cricket";
                            if (el.type === "generic-court" && "sport" in el)
                              return el.sport as Sport;
                            return null;
                          };
                          const elements = [...l.elements].sort((a, b) => {
                            const aCourt = isCourt(a.type);
                            const bCourt = isCourt(b.type);
                            if (aCourt && bCourt) {
                              const aPrimary = sportFor(a) === next ? 1 : 0;
                              const bPrimary = sportFor(b) === next ? 1 : 0;
                              return aPrimary - bPrimary;
                            }
                            // Non-court elements always render on top of
                            // courts (existing behaviour).
                            if (aCourt !== bCourt) return aCourt ? -1 : 1;
                            return 0;
                          });
                          return {
                            ...l,
                            primarySport: next,
                            elements,
                          };
                        });
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                    >
                      {layout.sports.map((s) => (
                        <option key={s} value={s}>
                          {SPORT_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <div className="text-[10.5px] text-slate-500 mt-1.5 leading-snug">
                      Primary court renders on top on the plot. Change to
                      re-order which sport reads as the hero. Zone
                      colours (blue basketball · grey pickleball / volley
                      · green tennis / football / cricket · sand
                      badminton) come from the shared palette.
                    </div>
                  </CollapsibleSection>
                )}

                {/* Product / TDS / equipment browsing moved to the
                    dedicated Products / Equip. / TDS tabs above — no
                    longer duplicated here, keeping the Design tab focused
                    on editing the court. */}

                {/* Branding — watermark toggle (Fitoverse logo composited
                    into the bottom-right of 2D + 3D + video). */}
                <CollapsibleSection title="Branding">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!layout.style.watermarkUrl}
                      onChange={toggleWatermark}
                      className="accent-wa-green"
                    />
                    <div className="flex-1">
                      <div className="font-medium">Fitoverse logo watermark</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Bottom-right of 2D + 3D + video
                      </div>
                    </div>
                  </label>
                </CollapsibleSection>

                {selectedElement && (
                  <div className="border-t border-slate-200 pt-4">
                    <ElementInspector
                      element={selectedElement}
                      onUpdate={(patch) => updateElement(selectedElement.id, patch)}
                      onDelete={() => removeElement(selectedElement.id)}
                      onDuplicate={() => duplicateElement(selectedElement.id)}
                      onMoveZ={(d) => moveZ(selectedElement.id, d)}
                      onAddHighlightFromPreset={(preset) => {
                        // Court elements have x, y, rotation, width, height —
                        // that's what highlightZoneFromPreset needs. We
                        // gate this callback on court types below in
                        // ElementInspector so we can safely cast.
                        const court = selectedElement as unknown as {
                          x: number;
                          y: number;
                          rotation: number;
                          width: number;
                          height: number;
                        };
                        const zone = highlightZoneFromPreset(court, preset);
                        setLayout((prev) =>
                          prev
                            ? { ...prev, elements: [...prev.elements, zone] }
                            : prev,
                        );
                        setSelectedId(zone.id);
                      }}
                    />
                  </div>
                )}

                {!selectedElement && (
                  <div className="border-t border-slate-200 pt-4 text-xs text-slate-500 leading-relaxed">
                    💡 Click any element on the canvas to edit its size, color,
                    rotation, etc. Drag to move. Use the corner handles to resize
                    and the rotation handle to spin.
                  </div>
                )}
                  </>
                )}
              </div>

              {/* Right — canvas. On mobile shown above the controls so
                  the design stays primary and dimension labels fit. */}
              <div className="order-1 md:order-2 flex-1 min-w-0 min-h-[55vh] md:min-h-0 bg-slate-200 relative" ref={canvasContainerRef}>
                <CourtCanvas
                  handleRef={canvasRef}
                  layout={layout}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onUpdate={updateElement}
                  canvasWidth={canvasSize.width}
                  canvasHeight={canvasSize.height}
                  showGrid={layout.style.showGrid ?? true}
                  onSectionClick={(court, preset) => {
                    const c = court as unknown as {
                      x: number;
                      y: number;
                      rotation: number;
                      width: number;
                      height: number;
                    };
                    const zone = highlightZoneFromPreset(c, preset);
                    setLayout((prev) =>
                      prev
                        ? { ...prev, elements: [...prev.elements, zone] }
                        : prev,
                    );
                    setSelectedId(zone.id);
                  }}
                />
                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur rounded-md px-2.5 py-1 text-[11px] text-slate-700 shadow-sm">
                  <div>
                    Plot {layout.plot.lengthFt} × {layout.plot.widthFt} ft
                  </div>
                  {(() => {
                    // Find the primary sport court in layout.elements so
                    // sales sees the playing area size alongside the plot
                    // size. Small labels — doesn't clutter the canvas.
                    const primary = layout.elements.find((e) =>
                      [
                        "basketball-court",
                        "football-field",
                        "pickleball-court",
                        "generic-court",
                      ].includes(e.type),
                    );
                    if (!primary || !("width" in primary)) return null;
                    return (
                      <div className="text-slate-500">
                        Playing {Math.round(primary.width)} ×{" "}
                        {Math.round(primary.height)} ft
                      </div>
                    );
                  })()}
                </div>
                {/* Grid overlay toggle. Old designs default to grid ON
                    (matches historical look). New designs on continuous
                    surfaces start OFF because customers read the grid as
                    a tile pattern on solid acrylic / turf / PVC.
                    Bottom-left so it never covers the top-right DIMENSIONS
                    card (this is an editor-only control, not exported). */}
                <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur rounded-md px-2.5 py-1.5 text-[11px] shadow-sm flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={layout.style.showGrid ?? true}
                      onChange={(e) =>
                        setLayout({
                          ...layout,
                          style: {
                            ...layout.style,
                            showGrid: e.target.checked,
                          },
                        })
                      }
                      className="accent-wa-green"
                    />
                    <span className="text-slate-700">Grid overlay</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {step === 3 && layout && (
            <StepQuotation
              layout={layout}
              customerName={customerName}
              quoteEnabled={quoteEnabled}
              setQuoteEnabled={setQuoteEnabled}
              quoteNumber={quoteNumber}
              setQuoteNumber={setQuoteNumber}
              quoteTitle={quoteTitle}
              setQuoteTitle={setQuoteTitle}
              quoteNotes={quoteNotes}
              setQuoteNotes={setQuoteNotes}
              quoteItems={quoteItems}
              setQuoteItems={setQuoteItems}
              onReseed={() => seedQuoteFromRates(true)}
            />
          )}

          {step === 4 && (
            <Step3
              layout={layout}
              pngDataUrl3D={pngDataUrl3D}
              quoteEnabled={quoteEnabled}
              quoteNumber={quoteNumber}
              quoteTitle={quoteTitle}
              quoteNotes={quoteNotes}
              quoteItems={quoteItems}
              onEnsure3D={async () => {
                // Make sure the 3D scene is rendered + captured so the
                // combined PDF can include it even if the user never
                // opened the 3D tab. Switch to 3D, let it mount + the
                // environment/sky settle, then grab the PNG. The wait is
                // generous because PMREM + Sky take a moment on first paint
                // and a short wait was capturing a blank frame.
                setPreviewMode("3d-image");
                await new Promise((r) => setTimeout(r, 1400));
                return capture3D() ?? null;
              }}
              onCaptureAngles={async (onProgress) => {
                // Mount the 3D scene, then capture a turntable of 6 angles
                // for the PDF's all-angle grid (customer sees every side in
                // the static document, no link or video needed).
                setPreviewMode("3d-image");
                await new Promise((r) => setTimeout(r, 1400));
                const h = canvas3dRef.current;
                if (!h) return null;
                return (
                  (await h.captureSpinFrames({ frames: 6, onProgress })) ?? null
                );
              }}
              onUploadVideo={async () => {
                if (!videoBlob) return null;
                try {
                  return await uploadVideo(videoBlob);
                } catch {
                  return null;
                }
              }}
              previewMode={previewMode}
              setPreviewMode={setPreviewMode}
              pngDataUrl2D={pngDataUrl2D}
              view3d={view3d}
              setView3d={setView3d}
              caption={caption}
              setCaption={setCaption}
              contactPhone={contactPhone}
              setContactPhone={setContactPhone}
              customerName={customerName}
              canvas3dRef={canvas3dRef}
              preview3dContainerRef={preview3dContainerRef}
              preview3dSize={preview3dSize}
              Renderer3D={CourtCanvas3D}
              sendFormats={sendFormats}
              setSendFormats={setSendFormats}
              videoDataUrl={videoDataUrl}
              hasVideo={!!videoBlob}
              generatingVideo={generatingVideo}
              videoProgress={videoProgress}
              onGenerateVideo={generate3DVideo}
            />
          )}
        </div>

        {/* Footer — nav + actions */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
                className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 1 && (
              <button
                type="button"
                onClick={goStep2}
                disabled={!step1Valid}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                Open canvas →
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                onClick={goStep3}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-5 py-2 rounded-lg text-sm"
              >
                Quotation →
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={() => setStep(4)}
                className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-5 py-2 rounded-lg text-sm"
              >
                Preview & Send →
              </button>
            )}
            {step === 4 && (
              <>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={savingDraft || sending}
                  className="text-sm font-medium text-slate-700 hover:text-slate-900 border border-slate-300 hover:border-slate-400 px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {savingDraft ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={
                    sending ||
                    savingDraft ||
                    !contactPhone.trim() ||
                    selectedFormatCount(sendFormats) === 0 ||
                    (sendFormats["3d-video"] && !videoBlob)
                  }
                  className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-5 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {sending
                    ? "Sending…"
                    : `📤 Send ${selectedFormatCount(sendFormats)} image${
                        selectedFormatCount(sendFormats) !== 1 ? "s" : ""
                      } separately`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Step 1 — sports + dimensions
// ─────────────────────────────────────────────────────────────────────

type Step1SurfaceOption =
  | "plain"
  | "ppe_tile_red"
  | "acrylic_blue"
  | "acrylic_green"
  | "turf_40mm"
  | "turf_50mm"
  | "pvc_sports";

const ALL_SURFACE_OPTIONS: Array<{ id: Step1SurfaceOption; label: string }> = [
  { id: "plain", label: "Plain / undecided" },
  { id: "ppe_tile_red", label: "PPE tile — Red" },
  { id: "acrylic_blue", label: "Acrylic — Blue" },
  { id: "acrylic_green", label: "Acrylic — Green" },
  { id: "turf_40mm", label: "Turf — 40 mm" },
  { id: "turf_50mm", label: "Turf — 50 mm" },
  { id: "pvc_sports", label: "PVC sports floor" },
];

// Which surface finishes make sense per sport, so the appearance
// picker only offers relevant options (football → turf, basketball →
// tile/acrylic, racket sports → pvc/acrylic, etc.). "plain" is always
// offered. Multi-sport shows the union.
const SPORT_SURFACES: Record<string, Step1SurfaceOption[]> = {
  football: ["turf_40mm", "turf_50mm"],
  cricket: ["turf_40mm", "turf_50mm"],
  basketball: ["ppe_tile_red", "acrylic_blue", "acrylic_green"],
  tennis: ["acrylic_blue", "acrylic_green"],
  volleyball: ["pvc_sports", "acrylic_blue", "acrylic_green"],
  badminton: ["pvc_sports"],
  pickleball: ["pvc_sports", "acrylic_blue", "acrylic_green", "ppe_tile_red"],
  multisport: [
    "ppe_tile_red",
    "acrylic_blue",
    "acrylic_green",
    "turf_40mm",
    "turf_50mm",
    "pvc_sports",
  ],
};

function surfaceOptionsForSports(
  sports: Sport[],
): Array<{ id: Step1SurfaceOption; label: string }> {
  if (sports.length === 0) return ALL_SURFACE_OPTIONS;
  const allowed = new Set<Step1SurfaceOption>(["plain"]);
  for (const s of sports) {
    for (const surf of SPORT_SURFACES[s] ?? []) allowed.add(surf);
  }
  return ALL_SURFACE_OPTIONS.filter((o) => allowed.has(o.id));
}

function Step1(props: {
  customerName: string;
  setCustomerName: (v: string) => void;
  lengthFt: number;
  setLengthFt: (v: number) => void;
  widthFt: number;
  setWidthFt: (v: number) => void;
  selectedSports: Sport[];
  setSelectedSports: (v: Sport[]) => void;
  footballASide: 5 | 7 | 11 | null;
  setFootballASide: (v: 5 | 7 | 11 | null) => void;
  cricketStripM: 10 | 20;
  setCricketStripM: (v: 10 | 20) => void;
  cricketOrientation: "horizontal" | "vertical";
  setCricketOrientation: (v: "horizontal" | "vertical") => void;
  basketballHalfCourt: boolean;
  setBasketballHalfCourt: (v: boolean) => void;
  designMode: "standard" | "custom";
  setDesignMode: (v: "standard" | "custom") => void;
  initialSurface: Step1SurfaceOption;
  setInitialSurface: (v: Step1SurfaceOption) => void;
  baseWork: "" | "concrete" | "asphalt";
  setBaseWork: (v: "" | "concrete" | "asphalt") => void;
  flooringProduct: { id: string; name: string } | null;
  setFlooringProduct: (v: { id: string; name: string } | null) => void;
}) {
  const { unit, setUnit } = useUserUnit();
  const {
    customerName,
    setCustomerName,
    lengthFt,
    setLengthFt,
    widthFt,
    setWidthFt,
    selectedSports,
    setSelectedSports,
    footballASide,
    setFootballASide,
    cricketStripM,
    setCricketStripM,
    cricketOrientation,
    setCricketOrientation,
    basketballHalfCourt,
    setBasketballHalfCourt,
    designMode,
    setDesignMode,
    initialSurface,
    setInitialSurface,
    baseWork,
    setBaseWork,
    flooringProduct,
    setFlooringProduct,
  } = props;

  // Flooring products for the chosen sport(s), fetched from the internal
  // catalogue. Sales picks one as the design's flooring; the canvas
  // surface finish is inferred from it. Empty state falls back to the
  // manual appearance buttons below.
  const [flooringProducts, setFlooringProducts] = useState<
    Array<{ id: string; name: string; heroImageUrl: string | null; category: string | null }>
  >([]);
  const primarySportForFlooring = selectedSports[0];
  useEffect(() => {
    if (!primarySportForFlooring) {
      setFlooringProducts([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/products?type=flooring&sport=${primarySportForFlooring}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setFlooringProducts(
          (j.products ?? []).map(
            (p: { id: string; name: string; heroImageUrl: string | null; category: string | null }) => ({
              id: p.id,
              name: p.name,
              heroImageUrl: p.heroImageUrl,
              category: p.category,
            }),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setFlooringProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [primarySportForFlooring]);

  function toggleSport(sport: Sport) {
    const next = selectedSports.includes(sport)
      ? selectedSports.filter((s) => s !== sport)
      : [...selectedSports, sport];
    setSelectedSports(next);
    // Auto-apply the sport's canonical plot preset when it becomes the
    // sole pick so sales doesn't have to hunt for the chip. All values
    // are the playing area + safety run-off recommended by the
    // governing body of that sport. In non-standard (custom) mode the
    // sales team has typed their own plot dimensions — we skip the
    // auto-preset so their input isn't clobbered.
    if (designMode === "standard" && next.length === 1) {
      switch (next[0]) {
        case "basketball":
          setLengthFt(105); // FIBA With Run-Off 32 × 19 m
          setWidthFt(62);
          setInitialSurface("ppe_tile_red");
          break;
        case "football":
          setLengthFt(358); // FIFA 11-a-side 109 × 72 m
          setWidthFt(236);
          setInitialSurface("turf_40mm");
          break;
        case "pickleball":
          setLengthFt(60); // IPA standard 30 × 60 ft
          setWidthFt(30);
          setInitialSurface("pvc_sports");
          break;
        case "volleyball":
          setLengthFt(79); // FIVB 24 × 15 m (18 × 9 + 3 m free zone)
          setWidthFt(49);
          setInitialSurface("pvc_sports");
          break;
        case "tennis":
          setLengthFt(120); // ITF 36.6 × 18.3 m recommended
          setWidthFt(60);
          setInitialSurface("acrylic_blue");
          break;
        case "badminton":
          setLengthFt(57); // BWF 17.4 × 8.1 m
          setWidthFt(27);
          setInitialSurface("pvc_sports");
          break;
        case "cricket":
          setLengthFt(105); // Practice net + pitch 32 × 4 m
          setWidthFt(13);
          setInitialSurface("turf_40mm");
          break;
      }
    }
  }

  const showFootballConfig = selectedSports.includes("football");
  const showCricketConfig = selectedSports.includes("cricket");
  const showBasketballConfig = selectedSports.includes("basketball");
  // Sports without a dedicated config picker (pickleball, tennis, badminton,
  // volleyball, multisport) get the standards preset chips instead, so they
  // aren't left with no way to apply a governing-body size.
  const presetChipSports = selectedSports.filter(
    (s) => !["football", "cricket", "basketball"].includes(s),
  );

  // Display values are the user-facing unit; storage stays in feet.
  // Rounded to 1 decimal for meters, 0 for feet.
  const displayLen = unit === "ft" ? lengthFt : Number(toUnit(lengthFt, unit).toFixed(1));
  const displayWid = unit === "ft" ? widthFt : Number(toUnit(widthFt, unit).toFixed(1));

  // Two ways to enter plot dimensions in Standard mode:
  //   "lw"    → Length × Breadth inputs (the original UX)
  //   "total" → Total plot area in sq.ft, auto-split into L × W using
  //             the selected sport's aspect ratio (Basketball 105:62 →
  //             1.69, Football 358:236 → 1.52, etc.). Falls back to 3:2
  //             when no sport is picked yet.
  // Customer often knows "I have 7500 sq.ft" without a length/width.
  const [entryMode, setEntryMode] = useState<"lw" | "total">("lw");
  const [totalSqftInput, setTotalSqftInput] = useState<string>("");
  const activeRatio =
    lengthFt > 0 && widthFt > 0 ? lengthFt / widthFt : 1.5;
  const firstSportLabel =
    selectedSports.length > 0 ? SPORT_LABEL[selectedSports[0]] : null;

  function applyTotalSqft(raw: string) {
    setTotalSqftInput(raw);
    const t = parseFloat(raw);
    if (!isFinite(t) || t < 100) return;
    const w = Math.sqrt(t / activeRatio);
    const l = w * activeRatio;
    setWidthFt(Math.max(3, Math.round(w)));
    setLengthFt(Math.max(3, Math.round(l)));
  }

  return (
    <div className="p-6 sm:p-8 overflow-y-auto h-full max-w-3xl mx-auto space-y-6">
      {/* Design mode — standard preset court, or free-form custom
          shape. Custom is a placeholder for now; the free-form editor
          will land in a later release. */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">
          Court dimensions
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDesignMode("standard")}
            className={`px-4 py-3 rounded-lg border text-left transition ${
              designMode === "standard"
                ? "bg-wa-green/10 border-wa-green text-wa-dark"
                : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
            }`}
          >
            <div className="text-sm font-medium">Standard dimensions</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Pre-set FIBA / regulation size per sport
            </div>
          </button>
          <button
            type="button"
            onClick={() => setDesignMode("custom")}
            className={`px-4 py-3 rounded-lg border text-left transition ${
              designMode === "custom"
                ? "bg-wa-green/10 border-wa-green text-wa-dark"
                : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
            }`}
          >
            <div className="text-sm font-medium">Non-standard dimensions</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Free-form design · custom plot shape
            </div>
          </button>
        </div>
      </section>

      {designMode === "custom" && (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm font-semibold text-blue-900">
            Free-form design
          </div>
          <div className="text-xs text-blue-800 mt-1 leading-relaxed">
            Type your own plot dimensions below. In the design step you can
            rotate the court diagonally, resize it to fit an irregular area,
            or place multiple courts side by side. Sport-based auto-presets
            are skipped so your typed dimensions are what opens on the canvas.
          </div>
        </section>
      )}

      {(
        <>
      <section>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Customer</h3>
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Customer or project name"
          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Plot dimensions</h3>
          {/* Inline unit toggle — persists to the user's profile
              preference so every wizard + form respects it going forward.
              Sales asked where to switch to meters; putting it here in
              the wizard is more discoverable than the profile page. */}
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
        {/* Entry-method sub-toggle — pick Length × Breadth OR Total
            area. Standard mode only; custom mode always uses free
            L × W. */}
        {designMode === "standard" && (
          <div className="inline-flex bg-slate-100 rounded-md p-0.5 text-xs mb-3">
            <button
              type="button"
              onClick={() => setEntryMode("lw")}
              className={`px-3 py-1.5 rounded font-medium transition ${
                entryMode === "lw"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Length × Breadth
            </button>
            <button
              type="button"
              onClick={() => setEntryMode("total")}
              className={`px-3 py-1.5 rounded font-medium transition ${
                entryMode === "total"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Total area
            </button>
          </div>
        )}

        {entryMode === "total" && designMode === "standard" ? (
          <div>
            <label className="block">
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                Total plot area (sq.ft)
              </span>
              <input
                type="number"
                min={100}
                max={200000}
                step={100}
                value={totalSqftInput}
                onChange={(e) => applyTotalSqft(e.target.value)}
                placeholder="e.g. 7500"
                className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
              />
            </label>
            <div className="text-[11px] text-slate-500 mt-2">
              {totalSqftInput && parseFloat(totalSqftInput) >= 100 ? (
                <>
                  Split into{" "}
                  <span className="font-medium text-slate-700">
                    {lengthFt} × {widthFt} ft
                  </span>{" "}
                  {firstSportLabel
                    ? `using ${firstSportLabel} aspect ratio`
                    : "at 3:2 ratio — pick a sport for a smarter split"}
                </>
              ) : firstSportLabel ? (
                <>Uses {firstSportLabel} aspect ratio to compute L × W.</>
              ) : (
                <>Pick a sport below for a smart split, or 3:2 is used.</>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                  Length ({unit})
                </span>
                <input
                  type="number"
                  min={unit === "m" ? 3 : 10}
                  max={unit === "m" ? 150 : 500}
                  step={unit === "m" ? 0.1 : 1}
                  value={displayLen}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value) || 0;
                    setLengthFt(toFeet(raw, unit));
                  }}
                  className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                  Width ({unit})
                </span>
                <input
                  type="number"
                  min={unit === "m" ? 3 : 10}
                  max={unit === "m" ? 150 : 500}
                  step={unit === "m" ? 0.1 : 1}
                  value={displayWid}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value) || 0;
                    setWidthFt(toFeet(raw, unit));
                  }}
                  className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                />
              </label>
            </div>
            {unit === "m" && (
              <div className="text-[10px] text-slate-500 mt-1">
                = {Math.round(lengthFt)} × {Math.round(widthFt)} ft (canonical)
              </div>
            )}
          </>
        )}
        {/* Dimensions come from the sport-specific config below where one
            exists (Football A-side, Cricket pitch, Basketball Full/Half);
            sports without a config (pickleball, tennis, badminton,
            volleyball, multisport) get the standards preset chips instead,
            so nobody ends up with two places to make the same choice. */}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">
          Sports <span className="text-xs font-normal text-slate-500">(pick one or more)</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SPORTS.map((sport) => {
            const active = selectedSports.includes(sport);
            return (
              <button
                key={sport}
                type="button"
                onClick={() => toggleSport(sport)}
                className={`px-3 py-2.5 text-sm rounded-lg border transition ${
                  active
                    ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium"
                    : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
                }`}
              >
                {SPORT_LABEL[sport]}
              </button>
            );
          })}
        </div>
      </section>

      {showFootballConfig && (
        <section className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Football config
          </h4>
          <div>
            <span className="text-[11px] text-slate-500 uppercase tracking-wide">
              A-side preset (drives marking proportions)
            </span>
            <div className="flex gap-2 mt-1">
              {(
                [
                  { side: 5, play: "131.2 × 65.6 ft · 40 × 20 m", plotL: 151, plotW: 85 },
                  { side: 7, play: "180 × 120 ft · 54.86 × 36.58 m", plotL: 193, plotW: 133 },
                  { side: 11, play: "344.5 × 223.1 ft · 105 × 68 m", plotL: 358, plotW: 236 },
                ] as const
              ).map(({ side, play, plotL, plotW }) => {
                const active = footballASide === side;
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() => {
                      if (active) {
                        // Deselect — leave the plot untouched so sales can
                        // enter a custom size.
                        setFootballASide(null);
                        return;
                      }
                      setFootballASide(side);
                      // Auto-apply the plot only when football is the sole
                      // sport, to avoid clobbering a multi-sport plot.
                      if (selectedSports.length === 1 && selectedSports[0] === "football") {
                        setLengthFt(plotL);
                        setWidthFt(plotW);
                      }
                    }}
                    className={`flex-1 px-3 py-2 rounded border text-left transition ${
                      active
                        ? "border-wa-green bg-wa-green/10 text-wa-dark"
                        : "border-slate-300 text-slate-600 hover:bg-white"
                    }`}
                  >
                    <div className="text-sm font-medium">{side}-a-side</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                      {play}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 italic">
              Tap the selected format again to deselect and enter a custom plot
              size.
            </p>
          </div>
        </section>
      )}

      {showCricketConfig && (
        <section className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Cricket config
          </h4>
          <div>
            <span className="text-[11px] text-slate-500 uppercase tracking-wide">
              Turf strip size
            </span>
            <div className="flex gap-2 mt-1">
              {(
                [
                  { m: 10 as const, dim: "6.6 × 32.8 ft" },
                  { m: 20 as const, dim: "6.6 × 65.6 ft" },
                ]
              ).map((opt) => (
                <button
                  key={opt.m}
                  type="button"
                  onClick={() => setCricketStripM(opt.m)}
                  className={`flex-1 px-3 py-2 rounded border text-left ${
                    cricketStripM === opt.m
                      ? "border-wa-green bg-wa-green/10 text-wa-dark"
                      : "border-slate-300 text-slate-600 hover:bg-white"
                  }`}
                >
                  <div className="text-sm font-medium">2 × {opt.m} m pitch</div>
                  <div className="text-[9px] text-slate-500 leading-tight">
                    {opt.dim}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[11px] text-slate-500 uppercase tracking-wide">
              Orientation
            </span>
            <div className="flex gap-2 mt-1">
              {(["horizontal", "vertical"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setCricketOrientation(o)}
                  className={`flex-1 px-3 py-2 text-sm rounded border capitalize ${
                    cricketOrientation === o
                      ? "border-wa-green bg-wa-green/10 text-wa-dark"
                      : "border-slate-300 text-slate-600 hover:bg-white"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {showBasketballConfig && (
        <section className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Basketball config
          </h4>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setBasketballHalfCourt(false);
                if (selectedSports.length === 1 && selectedSports[0] === "basketball") {
                  setLengthFt(105);
                  setWidthFt(62);
                }
              }}
              className={`px-3 py-2 rounded-md border text-left transition ${
                !basketballHalfCourt
                  ? "bg-wa-green text-white border-wa-green"
                  : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
              }`}
            >
              <div className="text-xs font-medium">Full court</div>
              <div className="text-[9px] opacity-75 leading-tight">
                92 × 49 ft · 28 × 15 m
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setBasketballHalfCourt(true);
                if (selectedSports.length === 1 && selectedSports[0] === "basketball") {
                  setLengthFt(62);
                  setWidthFt(49);
                }
              }}
              className={`px-3 py-2 rounded-md border text-left transition ${
                basketballHalfCourt
                  ? "bg-wa-green text-white border-wa-green"
                  : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
              }`}
            >
              <div className="text-xs font-medium">Half court (3×3)</div>
              <div className="text-[9px] opacity-75 leading-tight">
                49 × 36 ft · 15 × 11 m
              </div>
            </button>
          </div>
          <div className="text-[11px] text-slate-500">
            {basketballHalfCourt
              ? "FIBA 3x3 Olympic playing area is 15 × 11 m. Plot includes a 2 m safety run-off on all sides."
              : "FIBA regulation playing area is 28 × 15 m. Plot includes a 2 m safety run-off on all sides."}
          </div>
        </section>
      )}

      {/* Standards presets for sports without a dedicated config picker
          (pickleball, tennis, badminton, volleyball, multisport). */}
      {presetChipSports.length > 0 && (
        <section className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <DimensionPresets
            sports={presetChipSports}
            unit={unit}
            currentLengthFt={lengthFt}
            currentWidthFt={widthFt}
            onPick={(p) => {
              setLengthFt(Math.round(p.lengthFt));
              setWidthFt(Math.round(p.widthFt));
            }}
          />
        </section>
      )}

      {/* Base work — sub-base under the flooring. Informational; shows
          in the combined PDF / quote. */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">
          Base work
        </h3>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "", label: "Not decided" },
              { id: "concrete", label: "Concrete" },
              { id: "asphalt", label: "Asphalt" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setBaseWork(opt.id)}
              className={`px-3 py-2 text-xs rounded-md border transition ${
                baseWork === opt.id
                  ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium"
                  : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Flooring — driven by the internal product catalogue, filtered
          by the primary sport. Picking a product records it on the
          design AND infers the canvas surface finish. Empty state falls
          back to the manual appearance picker below. */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Flooring product
          {primarySportForFlooring && (
            <span className="text-xs font-normal text-slate-500">
              {" "}
              · {SPORT_LABEL[primarySportForFlooring]}
            </span>
          )}
        </h3>
        <div className="text-[11px] text-slate-500 mb-3">
          Pick from Fitoverse&apos;s catalogue. Add more in the Products
          page. Only {primarySportForFlooring ? SPORT_LABEL[primarySportForFlooring] : "the chosen sport's"} floorings are listed.
        </div>
        {flooringProducts.length === 0 ? (
          <div className="text-[11px] text-slate-500 italic bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            No flooring products for this sport yet — pick an appearance
            below, or add products in the Products page.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {flooringProducts.map((p) => {
              const active = flooringProduct?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setFlooringProduct(active ? null : { id: p.id, name: p.name });
                    if (!active) {
                      const inferred = surfaceFromProduct(p.category, p.name);
                      if (inferred !== "plain") setInitialSurface(inferred);
                    }
                  }}
                  className={`text-left rounded-md border overflow-hidden transition ${
                    active
                      ? "border-wa-green ring-2 ring-wa-green/30"
                      : "border-slate-300 hover:border-slate-400"
                  }`}
                >
                  <div className="aspect-video bg-slate-100">
                    {p.heroImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.heroImageUrl}
                        alt={p.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">
                        No photo
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5 text-[11px] font-medium text-slate-800 leading-tight line-clamp-2">
                    {p.name}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Surface appearance — how the flooring renders on the canvas.
          Filtered to finishes that make sense for the chosen sport
          (football/cricket → turf; basketball → tile/acrylic; racket
          sports → pvc/acrylic). Auto-set when a flooring product is
          picked; sales can override here. */}
      <section>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">
          Surface appearance
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {surfaceOptionsForSports(selectedSports).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setInitialSurface(opt.id)}
              className={`px-3 py-2 text-xs rounded-md border transition text-left ${
                initialSurface === opt.id
                  ? "bg-wa-green/10 border-wa-green text-wa-dark font-medium"
                  : "bg-white border-slate-300 text-slate-700 hover:border-slate-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 mt-2">
          Material quantities (tile count / litres of acrylic) show on
          the design once the canvas opens.
        </div>
      </section>

      <div className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg p-3 leading-relaxed">
        ℹ️ In the next step you can drag, resize and rotate everything — change the
        pitch position, swap colors, add labels, etc. Initial layout is just a
        starting point.
      </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Step 3 — Quotation (seed name / notes / line items → combined PDF)
// ─────────────────────────────────────────────────────────────────────

type ExistingQuoteRow = {
  id: string;
  number: string;
  customerName: string;
  grandTotal: string;
  status: string;
  sport: string;
  sentAt: string | null;
  createdAt: string;
};

// Pull a previously-created/sent quotation into this design so the two can be
// sent together (e.g. we quoted the customer earlier, now they want the
// design + that same quote in one PDF). Loads the saved line items in place.
function ExistingQuotePicker({
  onLoad,
}: {
  onLoad: (q: {
    number: string;
    notes: string;
    items: QuoteLineItem[];
  }) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ExistingQuoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Server-side search so this scales to thousands of quotes: the API filters
  // by customer name / quote number / phone and returns the newest 200
  // matches, instead of shipping the whole table to the browser.
  const fetchList = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const qs = search.trim()
        ? `?search=${encodeURIComponent(search.trim())}`
        : "";
      const r = await fetch(`/api/quotations${qs}`);
      const j = await r.json().catch(() => ({ quotations: [] }));
      setList(j.quotations ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  function toggle() {
    setOpen((v) => !v);
  }

  // Fetch on open, and again (debounced) on every search change. Empty query
  // loads the most recent quotes so the list isn't blank before you type.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void fetchList(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, query, fetchList]);

  async function pick(id: string, number: string) {
    setLoadingId(id);
    try {
      const r = await fetch(`/api/quotations/${id}`);
      if (!r.ok) {
        toast.error("Couldn't load that quotation");
        return;
      }
      const j = await r.json();
      const q = j.quotation ?? {};
      const items: QuoteLineItem[] = (q.lineItems ?? []).map(
        (li: {
          name?: string;
          description?: string;
          areaSqFt?: number;
          ratePerSqFt?: number;
          gstPercent?: number;
          included?: boolean;
        }) => ({
          id: newQuoteLineId(),
          name: li.name ?? "",
          desc: li.description ?? "",
          qty: Number(li.areaSqFt) || 0,
          unit: "sq.ft",
          rate: Number(li.ratePerSqFt) || 0,
          gst: Number(li.gstPercent) || 18,
          included: li.included !== false,
        }),
      );
      if (items.length === 0) {
        toast.error("That quotation has no line items");
        return;
      }
      onLoad({ number: q.number ?? number, notes: q.notes ?? "", items });
      toast.success(`Loaded quotation ${q.number ?? number}`);
      setOpen(false);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          Already quoted this customer? Pull that quote in so the design + the
          same quotation go out as one PDF.
        </div>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:border-slate-400"
        >
          {open ? "Close" : "📎 Attach an existing quotation"}
        </button>
      </div>
      {open && (
        <div className="mt-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍  Search by customer name or quote no…"
            autoFocus
            className="w-full text-xs px-3 py-2 mb-2 rounded-md border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-wa-green"
          />
          <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white divide-y divide-slate-100">
          {loading ? (
            <div className="px-3 py-3 text-xs text-slate-500 italic">Loading…</div>
          ) : list.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500 italic">
              {query
                ? `No quotations match "${query}".`
                : "No saved quotations yet."}
            </div>
          ) : (
            list.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="text-xs font-semibold text-slate-800">
                    {q.customerName}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {" "}
                    · {q.number} · {cap(q.sport)}
                  </span>
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  <span className="text-xs text-slate-700 tabular-nums">
                    ₹{Number(q.grandTotal).toLocaleString("en-IN")}
                  </span>
                  <span
                    className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase ${
                      q.status === "sent"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {q.status}
                  </span>
                  {/* View the quote as a PDF first, then Attach to confirm. */}
                  <a
                    href={`/api/quotations/${q.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-slate-700 border border-slate-300 rounded px-2 py-1 hover:bg-white whitespace-nowrap"
                  >
                    👁 View
                  </a>
                  <button
                    type="button"
                    disabled={loadingId === q.id}
                    onClick={() => pick(q.id, q.number)}
                    className="text-[11px] font-medium text-white bg-wa-green hover:bg-wa-green/90 disabled:opacity-50 rounded px-2.5 py-1"
                  >
                    {loadingId === q.id ? "…" : "Attach"}
                  </button>
                </span>
              </div>
            ))
          )}
          </div>
          {list.length >= 200 && (
            <div className="mt-1 text-[10px] text-slate-400">
              Showing the first 200 — type a customer name or quote no. to
              narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepQuotation({
  layout,
  customerName,
  quoteEnabled,
  setQuoteEnabled,
  quoteNumber,
  setQuoteNumber,
  quoteTitle,
  setQuoteTitle,
  quoteNotes,
  setQuoteNotes,
  quoteItems,
  setQuoteItems,
  onReseed,
}: {
  layout: CourtLayout;
  customerName: string;
  quoteEnabled: boolean;
  setQuoteEnabled: (v: boolean) => void;
  quoteNumber: string;
  setQuoteNumber: (v: string) => void;
  quoteTitle: string;
  setQuoteTitle: (v: string) => void;
  quoteNotes: string;
  setQuoteNotes: (v: string) => void;
  quoteItems: QuoteLineItem[];
  setQuoteItems: React.Dispatch<React.SetStateAction<QuoteLineItem[]>>;
  onReseed: () => void;
}) {
  const totals = computeQuoteTotals(quoteItems);
  const area = layout.plot.lengthFt * layout.plot.widthFt;

  function patch(id: string, next: Partial<QuoteLineItem>) {
    setQuoteItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...next } : it)),
    );
  }
  function remove(id: string) {
    setQuoteItems((prev) => prev.filter((it) => it.id !== id));
  }
  function addRow() {
    setQuoteItems((prev) => [
      ...prev,
      {
        id: newQuoteLineId(),
        name: "",
        desc: "",
        qty: 1,
        unit: "nos",
        rate: 0,
        gst: 18,
        included: true,
      },
    ]);
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Quotation
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Seed a quote for {customerName || "this customer"} — it&apos;s
              attached to the combined PDF on the next step. Line items are
              pre-filled from the {cap(layout.sports[0] ?? "sport")} rate
              sheet, sized to {layout.plot.lengthFt} × {layout.plot.widthFt} ft
              ({area.toLocaleString("en-IN")} sq.ft).
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={quoteEnabled}
              onChange={(e) => setQuoteEnabled(e.target.checked)}
              className="accent-wa-green w-4 h-4"
            />
            Attach quote to PDF
          </label>
        </div>

        {!quoteEnabled ? (
          <div className="text-sm text-slate-500 italic bg-white border border-dashed border-slate-200 rounded-lg px-4 py-6 text-center">
            Quote is off. Tick “Attach quote to PDF” to build one, or skip
            straight to Send.
          </div>
        ) : (
          <>
            {/* Attach a previously-created quotation instead of starting fresh */}
            <ExistingQuotePicker
              onLoad={({ number, notes, items }) => {
                setQuoteNumber(number);
                if (notes) setQuoteNotes(notes);
                setQuoteItems(items);
              }}
            />
            {/* Header fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">
                  Quotation number
                </span>
                <input
                  value={quoteNumber}
                  onChange={(e) => setQuoteNumber(e.target.value)}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">
                  Title / project name
                </span>
                <input
                  value={quoteTitle}
                  onChange={(e) => setQuoteTitle(e.target.value)}
                  placeholder="e.g. Salem 7-a-side turf"
                  className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">
                Notes / description
              </span>
              <textarea
                value={quoteNotes}
                onChange={(e) => setQuoteNotes(e.target.value)}
                rows={2}
                placeholder="Scope, inclusions, validity, payment terms…"
                className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-wa-green/30"
              />
            </label>

            {/* Line items */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
                <span className="text-xs font-semibold text-slate-700">
                  Line items
                </span>
                <button
                  type="button"
                  onClick={onReseed}
                  className="text-[11px] text-wa-dark hover:underline"
                >
                  ↺ Reset from rate sheet
                </button>
              </div>

              {/* Column header (desktop) */}
              <div className="hidden sm:grid grid-cols-[auto_1fr_6rem_5rem_7rem_7rem_auto] gap-2.5 px-4 py-2 text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                <span></span>
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span>Unit</span>
                <span className="text-right">Rate ₹</span>
                <span className="text-right">Amount</span>
                <span></span>
              </div>

              <div className="divide-y divide-slate-100">
                {quoteItems.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] text-slate-500 italic">
                    No line items. Add one below or reset from the rate sheet.
                  </div>
                ) : (
                  quoteItems.map((it) => {
                    const amount = Math.round(it.qty * it.rate);
                    return (
                      <div
                        key={it.id}
                        className="grid grid-cols-2 sm:grid-cols-[auto_1fr_6rem_5rem_7rem_7rem_auto] gap-2.5 px-4 py-3 items-center"
                      >
                        <input
                          type="checkbox"
                          checked={it.included}
                          onChange={(e) =>
                            patch(it.id, { included: e.target.checked })
                          }
                          className="accent-wa-green w-4 h-4 row-start-1"
                          title="Include in quote"
                        />
                        <div className="col-span-2 sm:col-span-1 order-last sm:order-none">
                          <input
                            value={it.name}
                            onChange={(e) => patch(it.id, { name: e.target.value })}
                            placeholder="Item name"
                            className={`w-full px-3 py-2 text-base font-semibold border border-slate-300 rounded-md ${
                              it.included ? "text-slate-900" : "text-slate-400"
                            }`}
                          />
                          <textarea
                            value={it.desc}
                            onChange={(e) => patch(it.id, { desc: e.target.value })}
                            placeholder="Description (optional)"
                            rows={6}
                            className="mt-2 w-full px-3 py-2.5 text-sm text-slate-600 border border-slate-300 hover:border-slate-400 focus:border-slate-400 rounded-md resize-y leading-relaxed min-h-[7rem]"
                          />
                        </div>
                        <input
                          type="number"
                          value={it.qty}
                          onChange={(e) =>
                            patch(it.id, { qty: Number(e.target.value) || 0 })
                          }
                          className="w-full px-2 py-1.5 text-sm text-right border border-slate-200 rounded"
                        />
                        <input
                          value={it.unit}
                          onChange={(e) => patch(it.id, { unit: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded"
                        />
                        <input
                          type="number"
                          value={it.rate}
                          onChange={(e) =>
                            patch(it.id, { rate: Number(e.target.value) || 0 })
                          }
                          className="w-full px-2 py-1.5 text-sm text-right border border-slate-200 rounded"
                        />
                        <span className="text-sm text-right text-slate-700 tabular-nums">
                          ₹{amount.toLocaleString("en-IN")}
                        </span>
                        <button
                          type="button"
                          onClick={() => remove(it.id)}
                          className="text-slate-400 hover:text-red-500 text-sm justify-self-end"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-3 py-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={addRow}
                  className="text-[11px] text-wa-dark hover:bg-wa-green/5 border border-dashed border-wa-green/40 rounded-md px-3 py-1"
                >
                  + Add line item
                </button>
              </div>

              {/* Totals */}
              <div className="px-3 py-2.5 border-t border-slate-200 bg-slate-50 space-y-0.5 text-[12px]">
                <div className="ml-auto max-w-[16rem] space-y-0.5">
                  <Row label="Subtotal" value={totals.subtotal} />
                  <Row label="GST" value={totals.gst} />
                  <Row label="Grand total" value={totals.grandTotal} strong />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              GST is computed per line from each item&apos;s rate-sheet
              percentage. Unticked rows are excluded from the total and the
              PDF.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Step 4 — preview + send
// ─────────────────────────────────────────────────────────────────────

function Step3({
  layout,
  pngDataUrl3D,
  quoteEnabled,
  quoteNumber,
  quoteTitle,
  quoteNotes,
  quoteItems,
  onCaptureAngles,
  onUploadVideo,
  onEnsure3D,
  previewMode,
  setPreviewMode,
  pngDataUrl2D,
  view3d,
  setView3d,
  caption,
  setCaption,
  contactPhone,
  setContactPhone,
  customerName,
  canvas3dRef,
  preview3dContainerRef,
  preview3dSize,
  Renderer3D,
  sendFormats,
  setSendFormats,
  videoDataUrl,
  hasVideo,
  generatingVideo,
  videoProgress,
  onGenerateVideo,
}: {
  layout: CourtLayout | null;
  pngDataUrl3D: string | null;
  quoteEnabled: boolean;
  quoteNumber: string;
  quoteTitle: string;
  quoteNotes: string;
  quoteItems: QuoteLineItem[];
  onCaptureAngles: (
    onProgress?: (fraction: number) => void,
  ) => Promise<string[] | null>;
  onUploadVideo: () => Promise<string | null>;
  onEnsure3D: () => Promise<string | null>;
  previewMode: "2d" | "3d-image" | "3d-video";
  setPreviewMode: (v: "2d" | "3d-image" | "3d-video") => void;
  pngDataUrl2D: string | null;
  view3d: CourtView;
  setView3d: (v: CourtView) => void;
  caption: string;
  setCaption: (v: string) => void;
  contactPhone: string;
  setContactPhone: (v: string) => void;
  customerName: string;
  canvas3dRef: React.MutableRefObject<CourtCanvas3DHandle | null>;
  preview3dContainerRef: React.RefObject<HTMLDivElement>;
  preview3dSize: { width: number; height: number };
  Renderer3D: React.ComponentType<{
    layout: CourtLayout;
    canvasWidth: number;
    canvasHeight: number;
    handleRef?: React.MutableRefObject<CourtCanvas3DHandle | null>;
    view?: CourtView;
  }>;
  sendFormats: { "2d": boolean; "3d-image": boolean; "3d-video": boolean };
  setSendFormats: (
    v: { "2d": boolean; "3d-image": boolean; "3d-video": boolean }
  ) => void;
  videoDataUrl: string | null;
  hasVideo: boolean;
  generatingVideo: boolean;
  videoProgress: number;
  onGenerateVideo: () => void;
}) {
  const total = selectedFormatCount(sendFormats);

  function toggleFormat(k: "2d" | "3d-image" | "3d-video") {
    setSendFormats({ ...sendFormats, [k]: !sendFormats[k] });
  }

  // The 3D image and 3D video tabs both need the 3D scene mounted so the
  // recorder + snapshot handles are available. We keep the 3D renderer
  // mounted whenever either tab is active.
  const needs3DMount = previewMode === "3d-image" || previewMode === "3d-video";

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] h-full overflow-hidden">
      <div className="bg-slate-900 flex flex-col">
        {/* Preview tab bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 flex-wrap">
          <div className="inline-flex bg-slate-800 rounded-lg p-0.5">
            {(
              [
                { id: "2d" as const, label: "2D plan" },
                { id: "3d-image" as const, label: "3D image" },
                { id: "3d-video" as const, label: "3D video" },
              ]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPreviewMode(t.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  previewMode === t.id
                    ? "bg-white text-slate-900"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* 3D view-preset buttons (3D image tab only — for video the
              camera path is auto-orbit). */}
          {previewMode === "3d-image" && (
            <div className="inline-flex bg-slate-800 rounded-lg p-0.5 text-[11px]">
              {(["orbit", "top", "iso", "side"] as CourtView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView3d(v)}
                  className={`px-2.5 py-1 rounded-md transition capitalize ${
                    view3d === v
                      ? "bg-white text-slate-900"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          <div className="text-[11px] text-slate-500 ml-auto">
            {previewMode === "2d" && "Flat plan view — fast, works everywhere"}
            {previewMode === "3d-image" &&
              "Drag to rotate, scroll to zoom — captured at send"}
            {previewMode === "3d-video" &&
              "6-second auto-orbit MP4 — auto-plays in WhatsApp"}
          </div>
        </div>
        {/* Preview area */}
        <div className="flex-1 relative min-h-0">
          {previewMode === "2d" && (
            <div className="absolute inset-0 overflow-auto p-6 flex items-center justify-center">
              {pngDataUrl2D ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pngDataUrl2D}
                  alt="Court design preview"
                  className="max-w-full max-h-full object-contain shadow-2xl rounded-lg bg-white"
                />
              ) : (
                <div className="text-sm text-slate-300">Generating preview…</div>
              )}
            </div>
          )}

          {/* 3D scene — kept mounted for both image + video tabs so the
              recorder + snapshot handle are ready, but visually hidden
              for the video tab if a recorded video exists to preview. */}
          {needs3DMount && (
            <div
              ref={preview3dContainerRef}
              className={`absolute inset-0 min-h-[360px] ${
                previewMode === "3d-video" && videoDataUrl ? "invisible" : ""
              }`}
            >
              {layout &&
                preview3dSize.width > 0 &&
                preview3dSize.height > 0 && (
                  <Renderer3D
                    layout={layout}
                    canvasWidth={preview3dSize.width}
                    canvasHeight={preview3dSize.height}
                    handleRef={canvas3dRef}
                    view={previewMode === "3d-image" ? view3d : "orbit"}
                  />
                )}
            </div>
          )}

          {/* Video preview overlay on the 3D video tab */}
          {previewMode === "3d-video" && videoDataUrl && (
            <div className="absolute inset-0 bg-black flex items-center justify-center p-4">
              <video
                key={videoDataUrl}
                src={videoDataUrl}
                controls
                autoPlay
                loop
                playsInline
                className="max-w-full max-h-full rounded-lg shadow-2xl"
              />
            </div>
          )}
        </div>
        {/* Video tab footer — generate button + progress */}
        {previewMode === "3d-video" && (
          <div className="px-4 py-3 border-t border-slate-800 flex items-center gap-3">
            <button
              type="button"
              onClick={onGenerateVideo}
              disabled={generatingVideo}
              className="bg-wa-green hover:bg-wa-green/90 text-white text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
            >
              {generatingVideo
                ? `Recording… ${Math.round(videoProgress * 100)}%`
                : hasVideo
                  ? "Re-record"
                  : "🎬 Generate orbit video"}
            </button>
            {generatingVideo && (
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-wa-green transition-all"
                  style={{ width: `${videoProgress * 100}%` }}
                />
              </div>
            )}
            {hasVideo && !generatingVideo && (
              <div className="text-[11px] text-emerald-400">
                ✓ Video ready — toggle the checkbox to send it
              </div>
            )}
            {!hasVideo && !generatingVideo && (
              <div className="text-[11px] text-slate-500">
                Records a 6-second auto-orbit. Takes ~10s.
              </div>
            )}
          </div>
        )}
      </div>
      <div className="border-l border-slate-200 p-5 overflow-y-auto overflow-x-hidden space-y-5 min-w-0">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Sending to</h3>
          <div className="text-sm text-slate-700">{customerName}</div>
          <label className="block mt-3">
            <span className="text-[11px] text-slate-500 uppercase tracking-wide">
              WhatsApp phone (E.164)
            </span>
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+919876543210"
              className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </label>
        </div>

        {/* Primary send path — the all-in-one combined PDF. Shown first
            and prominently because sales asked "send as PDF" and got
            only the design image (they'd used the individual-image
            sender below). This is the recommended way to send. */}
        {layout && (
          <CombinedPdfBlock
            layout={layout}
            pngDataUrl2D={pngDataUrl2D}
            pngDataUrl3D={pngDataUrl3D}
            onEnsure3D={onEnsure3D}
            onCaptureAngles={onCaptureAngles}
            onUploadVideo={onUploadVideo}
            onGenerateVideo={onGenerateVideo}
            generatingVideo={generatingVideo}
            videoProgress={videoProgress}
            hasVideo={hasVideo}
            canvas3dRef={canvas3dRef}
            contactPhone={contactPhone}
            customerName={customerName}
            quoteEnabled={quoteEnabled}
            quoteNumber={quoteNumber}
            quoteTitle={quoteTitle}
            quoteNotes={quoteNotes}
            quoteItems={quoteItems}
          />
        )}

        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">
            Or send individual images{" "}
            <span className="text-xs font-normal text-slate-500">({total} selected)</span>
          </h3>
          <div className="space-y-1.5">
            <FormatCheckbox
              checked={sendFormats["2d"]}
              onChange={() => toggleFormat("2d")}
              label="2D plan"
              hint="Flat technical drawing with dimensions"
            />
            <FormatCheckbox
              checked={sendFormats["3d-image"]}
              onChange={() => toggleFormat("3d-image")}
              label="3D image"
              hint="Hero snapshot of the 3D scene"
            />
            <FormatCheckbox
              checked={sendFormats["3d-video"]}
              onChange={() => {
                if (!hasVideo && !sendFormats["3d-video"]) {
                  // turning ON — auto-jump to the video tab so they can generate
                  setPreviewMode("3d-video");
                }
                toggleFormat("3d-video");
              }}
              label="3D video"
              hint={
                hasVideo
                  ? "6-second auto-orbit MP4 — ready"
                  : "Open the 3D video tab and click Generate first"
              }
              disabled={!hasVideo}
            />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Caption</h3>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            placeholder={`Here's the court design for ${customerName}.\n\nLet me know if anything needs to change.`}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 resize-none"
          />
          <div className="text-[11px] text-slate-500 mt-1">
            Caption is attached to the first item sent.
          </div>
        </div>
        <div className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded p-2.5 leading-relaxed">
          💡 Each checked format is sent as its own WhatsApp message in the
          order 2D → 3D image → 3D video. Pick any combination.
        </div>
      </div>
    </div>
  );
}

// Colour-name prompt shown at the top of the Design tab the moment a
// highlight zone is selected — "what colour?" per the user's ask.
// Resolves a typed name (sky blue, maroon…) to a shade and keeps the
// zone's current opacity.
function HighlightColorPrompt({
  fill,
  onColor,
}: {
  fill: string;
  onColor: (rgba: string) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  // Preserve the current alpha from the existing rgba() fill.
  const alphaMatch = fill.match(/rgba?\([^)]*,\s*([\d.]+)\)\s*$/);
  const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 0.45;
  const swatch = fill;

  function apply(v: string) {
    setText(v);
    if (!v.trim()) {
      setError(false);
      return;
    }
    const { hex } = resolveColorName(v);
    if (!hex) {
      setError(true);
      return;
    }
    setError(false);
    const m = hex.replace("#", "").match(/.{2}/g);
    if (!m) return;
    const [r, g, b] = m.map((h) => parseInt(h, 16));
    onColor(`rgba(${r}, ${g}, ${b}, ${alpha})`);
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="text-xs font-semibold text-amber-900">
        Highlight colour — what colour?
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-7 h-7 rounded border border-amber-300 shrink-0"
          style={{ backgroundColor: swatch }}
        />
        <input
          type="text"
          value={text}
          list="fitoverse-color-names-inline"
          onChange={(e) => apply(e.target.value)}
          placeholder="Type a colour name (e.g. sky blue)"
          className={`flex-1 px-2 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400/40 ${
            error ? "border-red-400" : "border-amber-300"
          }`}
        />
      </div>
      <datalist id="fitoverse-color-names-inline">
        {knownColorNames().map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {error && (
        <div className="text-[10.5px] text-red-500">
          Couldn&apos;t match that name — try another, or use the full
          colour controls below.
        </div>
      )}
    </div>
  );
}

// Quote total row (label left, ₹value right).
function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${strong ? "font-semibold text-slate-900" : "text-slate-600"}`}
    >
      <span>{label}</span>
      <span>₹{value.toLocaleString("en-IN")}</span>
    </div>
  );
}

// Combined-PDF block in Step 3 — one PDF with the 2D plan, 3D image,
// the attached products / equipment / TDS, and (optionally) a quote.
// Builds server-side; can download or send over WhatsApp.
function CombinedPdfBlock({
  layout,
  pngDataUrl2D,
  pngDataUrl3D,
  onEnsure3D,
  onCaptureAngles,
  onUploadVideo,
  onGenerateVideo,
  generatingVideo,
  videoProgress,
  hasVideo,
  canvas3dRef,
  contactPhone,
  customerName,
  quoteEnabled,
  quoteNumber,
  quoteTitle,
  quoteNotes,
  quoteItems,
}: {
  layout: CourtLayout;
  pngDataUrl2D: string | null;
  pngDataUrl3D: string | null;
  onEnsure3D: () => Promise<string | null>;
  // Capture several 3D angles (turntable) for the PDF's all-angle grid.
  onCaptureAngles: (
    onProgress?: (fraction: number) => void,
  ) => Promise<string[] | null>;
  // Upload the generated 3D orbit video, returning its URL so the combined
  // PDF send can also fire the video as a follow-up WhatsApp message.
  onUploadVideo: () => Promise<string | null>;
  // Record the 3D orbit video (auto-mounts the scene). Lets sales generate
  // the video right here without hunting for the button on the 3D tab.
  onGenerateVideo: () => void;
  generatingVideo: boolean;
  videoProgress: number;
  hasVideo: boolean;
  canvas3dRef: React.MutableRefObject<CourtCanvas3DHandle | null>;
  contactPhone: string;
  customerName: string;
  // Quote seeded on the Quotation step — read-only here.
  quoteEnabled: boolean;
  quoteNumber: string;
  quoteTitle: string;
  quoteNotes: string;
  quoteItems: QuoteLineItem[];
}) {
  const toast = useToast();
  // Send the 3D orbit video alongside the PDF (on by default when a video
  // has been generated). The PDF carries the court from all angles as
  // still images; the video shows it spinning.
  const [alsoSendVideo, setAlsoSendVideo] = useState(true);
  const [busy, setBusy] = useState<
    "" | "view" | "download" | "send" | "email"
  >("");
  const [progress, setProgress] = useState(0);
  const [email, setEmail] = useState("");

  const att = layout.attachments ?? {
    productIds: [],
    equipmentIds: [],
    tdsIds: [],
  };
  const attachCount =
    att.productIds.length + att.equipmentIds.length + att.tdsIds.length;

  const includedCount = quoteItems.filter((i) => i.included).length;
  const quoteActive = quoteEnabled && includedCount > 0;
  const quoteTotals = computeQuoteTotals(quoteItems);

  async function build(mode: "view" | "download" | "send" | "email") {
    setBusy(mode);
    setProgress(0);
    // Open the preview/download tab NOW, in the click gesture — otherwise the
    // browser's popup blocker silently kills a window.open() that runs after
    // the async build. We point it at the PDF url once it's ready.
    const previewWin =
      mode === "view" || mode === "download" ? window.open("", "_blank") : null;
    try {
      const image2d = pngDataUrl2D ?? undefined;
      // All-angle 3D — capture a turntable set of stills so the PDF shows
      // the court from every side (the customer's "see all angles" without
      // a link or video). Falls back to a single snapshot if capture fails.
      let image3dAngles = (await onCaptureAngles((f) => setProgress(f))) ?? [];
      let image3d =
        pngDataUrl3D ?? canvas3dRef.current?.toDataURL(2) ?? undefined;
      if (image3dAngles.length === 0) {
        if (!image3d) image3d = (await onEnsure3D()) ?? undefined;
        if (image3d) image3dAngles = [image3d];
      } else if (!image3d) {
        image3d = image3dAngles[0];
      }
      // When sending, upload the spinning 3D video so the route can fire it
      // as a follow-up WhatsApp message right after the PDF.
      let videoUrl: string | undefined;
      if (mode === "send" && alsoSendVideo && hasVideo) {
        videoUrl = (await onUploadVideo()) ?? undefined;
      }
      const payload = {
        customerName,
        plotLabel: `${layout.plot.lengthFt} × ${layout.plot.widthFt} ft`,
        lengthFt: layout.plot.lengthFt,
        widthFt: layout.plot.widthFt,
        baseWork: layout.style.baseWork ?? null,
        flooringName: layout.style.flooringProductName ?? null,
        sports: layout.sports,
        image2d,
        image3d,
        image3dAngles,
        attachments: att,
        includeQuote: quoteActive,
        quote: quoteActive
          ? buildQuotePayload(quoteNumber, quoteTitle, quoteNotes, quoteItems)
          : undefined,
        videoUrl,
        send: mode === "send",
        contactPhone: mode === "send" ? contactPhone : undefined,
        email: mode === "email" ? email.trim() : undefined,
      };
      const r = await fetch("/api/court-images/combined-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "build_failed");
      if (mode === "send") {
        toast.success(
          j.sent
            ? j.videoSent
              ? "PDF + 3D video sent on WhatsApp"
              : "Combined PDF sent on WhatsApp"
            : "Built (send failed — check number)",
        );
      } else if (mode === "email") {
        if (j.emailed === "not_configured") {
          toast.error("Email isn't set up yet — PDF built, download link opened");
          window.open(j.url, "_blank");
        } else if (j.emailed) {
          toast.success(`Emailed to ${email.trim()}`);
        } else {
          toast.error("Email failed — download link opened");
          window.open(j.url, "_blank");
        }
      } else {
        // Point the pre-opened tab at the PDF; if the pop-up was blocked, try
        // once more and tell the user honestly if it's still blocked.
        let opened = false;
        if (previewWin && !previewWin.closed) {
          previewWin.location.href = j.url;
          opened = true;
        } else {
          opened = !!window.open(j.url, "_blank");
        }
        if (opened) {
          toast.success(
            mode === "view" ? "Preview opened in a new tab" : "Combined PDF ready",
          );
        } else {
          toast.error(
            "Pop-up blocked — allow pop-ups for this site, or use Download",
          );
        }
      }
    } catch (err) {
      // Nothing to show — close the blank preview tab we optimistically opened.
      previewWin?.close();
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy("");
      setProgress(0);
    }
  }

  return (
    <div className="border border-wa-green/30 bg-wa-green/5 rounded-lg p-3 space-y-2.5">
      <div className="text-sm font-semibold text-slate-900">
        Combined PDF
      </div>
      <div className="text-[11px] text-slate-600 leading-snug">
        One PDF with the 2D plan and the 3D court from{" "}
        <span className="font-medium">all angles</span> (a turntable of still
        shots)
        {attachCount > 0
          ? `, plus ${attachCount} attached item${attachCount !== 1 ? "s" : ""} (products / equipment / TDS)`
          : ""}
        . The spinning 3D video is sent right after.
      </div>
      <label
        className={`flex items-center gap-2 text-xs cursor-pointer ${
          hasVideo ? "text-slate-700" : "text-slate-500"
        }`}
      >
        <input
          type="checkbox"
          checked={alsoSendVideo && hasVideo}
          disabled={!hasVideo}
          onChange={(e) => setAlsoSendVideo(e.target.checked)}
          className="accent-wa-green"
        />
        Also send the 3D spinning video {hasVideo ? "(ready ✓)" : ""}
      </label>
      {/* Generate the video right here — no need to hunt for the button on
          the 3D tab. onGenerateVideo auto-mounts the 3D scene. */}
      {!hasVideo && (
        <button
          type="button"
          onClick={onGenerateVideo}
          disabled={generatingVideo || !!busy}
          className="w-full text-xs font-medium border border-wa-green/40 text-wa-dark hover:bg-wa-green/10 rounded-md px-3 py-2 disabled:opacity-50"
        >
          {generatingVideo
            ? `Recording video… ${Math.round(videoProgress * 100)}%`
            : "🎬 Generate the 3D spinning video (~10s)"}
        </button>
      )}
      {generatingVideo && (
        <div className="h-1.5 bg-wa-green/15 rounded-full overflow-hidden">
          <div
            className="h-full bg-wa-green transition-all"
            style={{ width: `${videoProgress * 100}%` }}
          />
        </div>
      )}
      {busy && progress > 0 && progress < 1 && (
        <div className="space-y-1">
          <div className="h-1.5 bg-wa-green/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-wa-green transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500">Capturing 3D angles…</div>
        </div>
      )}

      {/* Quote summary — seeded + edited on the Quotation step. Shown
          read-only here so sales can confirm what the PDF will carry. */}
      {quoteActive ? (
        <div className="border border-slate-200 rounded-md bg-white p-2 space-y-1 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">
              Quote {quoteNumber}
            </span>
            <span className="text-slate-500">
              {includedCount} item{includedCount !== 1 ? "s" : ""}
            </span>
          </div>
          {quoteTitle && (
            <div className="text-slate-600 truncate">{quoteTitle}</div>
          )}
          <div className="border-t border-slate-200 pt-1 mt-1 space-y-0.5">
            <Row label="Subtotal" value={quoteTotals.subtotal} />
            <Row label="GST" value={quoteTotals.gst} />
            <Row label="Grand total" value={quoteTotals.grandTotal} strong />
          </div>
          <div className="text-[10px] text-slate-400 pt-0.5">
            Edit on the Quotation step (← Back).
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 italic border border-dashed border-slate-200 rounded-md px-2 py-1.5">
          No quote attached. Go back to the Quotation step to add one.
        </div>
      )}
      {/* View / download the combined PDF first, then send. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => build("view")}
          disabled={!!busy || !pngDataUrl2D}
          className="flex-1 min-w-0 text-xs font-medium border border-slate-300 hover:border-slate-400 text-slate-700 rounded-md px-2 py-2 disabled:opacity-50"
        >
          {busy === "view" ? "Building…" : "👁 View PDF"}
        </button>
        <button
          type="button"
          onClick={() => build("download")}
          disabled={!!busy || !pngDataUrl2D}
          className="flex-1 min-w-0 text-xs font-medium border border-slate-300 hover:border-slate-400 text-slate-700 rounded-md px-2 py-2 disabled:opacity-50"
        >
          {busy === "download" ? "Building…" : "⬇ Download"}
        </button>
      </div>
      <button
        type="button"
        onClick={() => build("send")}
        disabled={!!busy || !pngDataUrl2D || !contactPhone}
        className="w-full text-sm font-semibold bg-wa-green hover:bg-wa-green/90 text-white rounded-md px-3 py-2.5 disabled:opacity-50"
      >
        {busy === "send" ? "Sending…" : "📤 Send on WhatsApp"}
      </button>
      {/* Email delivery — sends the PDF as an attachment. */}
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="customer@email.com"
          className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
        />
        <button
          type="button"
          onClick={() => build("email")}
          disabled={!!busy || !pngDataUrl2D || !email.trim()}
          className="shrink-0 text-xs font-medium border border-wa-green/40 text-wa-dark hover:bg-wa-green/10 rounded-md px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
        >
          {busy === "email" ? "Emailing…" : "Send by email"}
        </button>
      </div>
      {!pngDataUrl2D && (
        <div className="text-[10.5px] text-amber-700">
          Open the 2D preview first so the plan can be included.
        </div>
      )}
    </div>
  );
}

function FormatCheckbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 p-2 rounded-md border cursor-pointer transition ${
        checked
          ? "border-wa-green bg-wa-green/5"
          : "border-slate-200 bg-white hover:border-slate-300"
      } ${disabled && !checked ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => !disabled && onChange()}
        disabled={disabled && !checked}
        className="mt-0.5 accent-wa-green"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-900 leading-tight">{label}</div>
        <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</div>
      </div>
    </label>
  );
}

function selectedFormatCount(s: {
  "2d": boolean;
  "3d-image": boolean;
  "3d-video": boolean;
}): number {
  return (s["2d"] ? 1 : 0) + (s["3d-image"] ? 1 : 0) + (s["3d-video"] ? 1 : 0);
}

// ─────────────────────────────────────────────────────────────────────
//  Small UI bits
// ─────────────────────────────────────────────────────────────────────

function StepDots({ current }: { current: 1 | 2 | 3 | 4 }) {
  const labels = ["Sports", "Design", "Quotation", "Send"];
  return (
    <div className="flex items-center gap-2 text-xs">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        const active = n === current;
        const done = n < current;
        return (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                active
                  ? "bg-wa-green text-white"
                  : done
                    ? "bg-wa-green/15 text-wa-dark"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {n}
            </div>
            <span className={active ? "text-slate-900 font-medium" : "text-slate-500"}>
              {label}
            </span>
            {n < labels.length && <span className="text-slate-300">·</span>}
          </div>
        );
      })}
    </div>
  );
}

function LayerList({
  elements,
  selectedId,
  onSelect,
  onToggleVisible,
  onToggleLocked,
}: {
  elements: Element[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
}) {
  // Sort by z DESC so visually top elements appear at the top of the list.
  const sorted = [...elements].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
        Layers
      </div>
      {sorted.map((el) => {
        const active = el.id === selectedId;
        return (
          <div
            key={el.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer ${
              active ? "bg-wa-green/15 text-wa-dark" : "hover:bg-white text-slate-700"
            }`}
            onClick={() => onSelect(el.id)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible(el.id);
              }}
              className="text-slate-500 hover:text-slate-700"
              title="Toggle visibility"
            >
              {el.visible === false ? "⊘" : "👁"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLocked(el.id);
              }}
              className="text-slate-500 hover:text-slate-700"
              title="Toggle lock"
            >
              {el.locked ? "🔒" : "🔓"}
            </button>
            <span className="flex-1 truncate">{shortLabel(el)}</span>
          </div>
        );
      })}
      {elements.length === 0 && (
        <div className="text-xs text-slate-500 italic px-2 py-2">No elements yet</div>
      )}
    </div>
  );
}

function shortLabel(el: Element): string {
  switch (el.type) {
    case "football-field":
      return `Football ${el.aSide}-a-side`;
    case "cricket-pitch":
      return "Cricket pitch";
    case "basketball-court":
      return el.halfCourt ? "Basketball half" : "Basketball";
    case "pickleball-court":
      return "Pickleball";
    case "generic-court":
      return el.sport;
    case "goal-post":
      return "Goal post";
    case "net":
      return "Net";
    case "annotation":
      return `Label · ${el.text.slice(0, 16)}`;
    case "custom-line":
      return "Line";
    case "custom-rect":
      return "Rectangle";
    case "fence-rect":
      return "Fence outline";
    case "dugout":
      return "Dugout";
    case "basketball-hoop":
      return "Hoop";
    case "highlight-zone":
      return "Highlight zone";
  }
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-slate-700 bg-white border border-slate-300 rounded px-2 py-1.5 hover:bg-slate-50 hover:border-slate-400 text-left"
    >
      + {label}
    </button>
  );
}

// Quick-pick international standard dimension chips. Appears after the
// Length/Width inputs and updates them when clicked. Filtered to the
// selected sport(s) so sales sees only relevant presets (e.g. picking
// "Basketball" surfaces both NBA + FIBA variants). Dimensions render
// in the current user's preferred unit.
function DimensionPresets({
  sports,
  unit,
  currentLengthFt,
  currentWidthFt,
  onPick,
}: {
  sports: Sport[];
  unit: "ft" | "m";
  currentLengthFt: number;
  currentWidthFt: number;
  onPick: (p: CourtPreset) => void;
}) {
  const isActive = (p: CourtPreset) => {
    const pl = Math.round(p.lengthFt);
    const pw = Math.round(p.widthFt);
    return (
      (currentLengthFt === pl && currentWidthFt === pw) ||
      (currentLengthFt === pw && currentWidthFt === pl)
    );
  };
  const presets = useMemo(
    () => presetsForSports(sports as string[]),
    [sports]
  );
  if (presets.length === 0) return null;

  // Group by variant ("NBA" / "FIBA") if any preset has one, otherwise
  // render a single flat row.
  const variants = Array.from(
    new Set(presets.map((p) => p.variant ?? "default"))
  );

  return (
    <div className="mt-3 space-y-2">
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
        International standards — click to apply
      </div>
      {variants.map((v) => (
        <div key={v}>
          {v !== "default" && (
            <div className="text-[10px] font-bold text-slate-600 uppercase mb-1">
              {v}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {presets
              .filter((p) => (p.variant ?? "default") === v)
              .map((p) => (
                <button
                  key={`${p.label}|${p.lengthFt}x${p.widthFt}`}
                  type="button"
                  onClick={() => onPick(p)}
                  className={`text-left px-2.5 py-1.5 text-xs rounded border transition ${
                    isActive(p)
                      ? "border-wa-green bg-wa-green/10 ring-1 ring-wa-green/40"
                      : "bg-white border-slate-300 hover:border-wa-green hover:bg-wa-green/5"
                  }`}
                >
                  <div className="font-medium text-slate-900 leading-tight flex items-center gap-1">
                    {isActive(p) && <span className="text-wa-green">✓</span>}
                    {stripVariantPrefix(p.label, v)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {unit === "ft"
                      ? `${Math.round(p.lengthFt)} × ${Math.round(p.widthFt)} ft · ${p.areaSqFt.toLocaleString("en-IN")} sqft`
                      : `${(p.lengthFt * FT_TO_M).toFixed(1)} × ${(p.widthFt * FT_TO_M).toFixed(1)} m · ${Math.round(p.areaSqFt * 0.0929).toLocaleString("en-IN")} m²`}
                  </div>
                  {p.hint && (
                    <div className="text-[9px] text-slate-400 mt-0.5 italic">
                      {p.hint}
                    </div>
                  )}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Trims "NBA " / "FIBA " prefix from labels when we're already showing a
// section header for the variant — avoids "NBA / NBA Play Area" stutter.
function stripVariantPrefix(label: string, variant: string): string {
  if (variant === "default") return label;
  const prefix = variant + " ";
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}
