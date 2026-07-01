"use client";

// Three-step wizard for designing a court image. Step 1 collects the
// sports + plot + sport-specific subconfigs. Step 2 hands the user to the
// Konva editor where everything is movable/resizable/rotatable. Step 3
// renders the PNG, uploads it to blob storage, saves the row, and (on
// confirm) sends it to the customer over WhatsApp.
//
// Same UX shape as QuoteWizard so sales gets a consistent flow.

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useToast } from "@/components/Toast";
import ElementInspector from "@/components/court-image/ElementInspector";
import type { CourtCanvasHandle } from "@/components/court-image/CourtCanvas";
import type { CourtCanvas3DHandle, CourtView } from "@/components/court-image/CourtCanvas3D";
import {
  buildInitialLayout,
  newAnnotation,
  newBasketballHoop,
  newCricketPitch,
  newCustomLine,
  newCustomRect,
  newDugout,
  newFenceRect,
  newGoalPost,
  SPORT_LABEL,
  type CourtLayout,
  type Element,
  type Sport,
} from "@/lib/court-image/schema";
import { presetsForSports, type CourtPreset } from "@/lib/court-image/sport-standards";
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
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [customerName, setCustomerName] = useState(prefill?.customerName ?? "");
  const [lengthFt, setLengthFt] = useState(80);
  const [widthFt, setWidthFt] = useState(60);
  const [selectedSports, setSelectedSports] = useState<Sport[]>(["football"]);
  const [footballASide, setFootballASide] = useState<5 | 7 | 11>(7);
  const [cricketLengthPreset, setCricketLengthPreset] = useState<22 | 16 | 12 | "custom">(22);
  const [cricketLengthCustom, setCricketLengthCustom] = useState(22);
  const [cricketOrientation, setCricketOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [basketballHalfCourt, setBasketballHalfCourt] = useState(false);

  // Step 2 state
  const [layout, setLayout] = useState<CourtLayout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      setCricketLengthPreset(22);
      setCricketLengthCustom(22);
      setCricketOrientation("horizontal");
      setFootballASide(7);
      setBasketballHalfCourt(false);
      setCaption("");
      setLayout(null);
      setSelectedId(null);
      setDraftId(null);
      setPngBlobUrl(null);
      setPngDataUrl2D(null);
      setPngDataUrl3D(null);
      setPreviewMode("2d");
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
    const cricketLengthFt =
      cricketLengthPreset === "custom"
        ? cricketLengthCustom * 3
        : cricketLengthPreset * 3;
    const initial = buildInitialLayout({
      plot: { lengthFt, widthFt },
      sports: selectedSports,
      config: {
        football: { aSide: footballASide },
        cricket: {
          pitchLengthFt: cricketLengthFt,
          pitchWidthFt: 10,
          orientation: cricketOrientation,
        },
        basketball: { halfCourt: basketballHalfCourt },
      },
      title: customerName,
    });
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
    if (!canvas3dRef.current) {
      toast.error("Open the 3D tab first so the scene mounts");
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
    }
    setLayout((prev) => (prev ? { ...prev, elements: [...prev.elements, newEl] } : prev));
    setSelectedId(newEl.id);
  }

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
  // Three.js renderer.
  useEffect(() => {
    if (step !== 3) return;
    if (previewMode !== "3d-image" && previewMode !== "3d-video") return;
    const el = preview3dContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setPreview3dSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setPreview3dSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
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
              cricketLengthPreset={cricketLengthPreset}
              setCricketLengthPreset={setCricketLengthPreset}
              cricketLengthCustom={cricketLengthCustom}
              setCricketLengthCustom={setCricketLengthCustom}
              cricketOrientation={cricketOrientation}
              setCricketOrientation={setCricketOrientation}
              basketballHalfCourt={basketballHalfCourt}
              setBasketballHalfCourt={setBasketballHalfCourt}
            />
          )}

          {step === 2 && layout && (
            <div className="flex h-full">
              {/* Left panel — layers + inspector + add */}
              <div className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto p-4 space-y-4">
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

                <div className="border-t border-slate-200 pt-4 space-y-2">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Add element
                  </div>
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
                </div>

                {/* Watermark toggle — Fitoverse logo composited into the
                    bottom-right of both 2D + 3D renders. On by default. */}
                <div className="border-t border-slate-200 pt-4">
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
                </div>

                {selectedElement && (
                  <div className="border-t border-slate-200 pt-4">
                    <ElementInspector
                      element={selectedElement}
                      onUpdate={(patch) => updateElement(selectedElement.id, patch)}
                      onDelete={() => removeElement(selectedElement.id)}
                      onDuplicate={() => duplicateElement(selectedElement.id)}
                      onMoveZ={(d) => moveZ(selectedElement.id, d)}
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
              </div>

              {/* Right — canvas */}
              <div className="flex-1 min-w-0 bg-slate-200 relative" ref={canvasContainerRef}>
                <CourtCanvas
                  handleRef={canvasRef}
                  layout={layout}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onUpdate={updateElement}
                  canvasWidth={canvasSize.width}
                  canvasHeight={canvasSize.height}
                />
                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur rounded-md px-2.5 py-1 text-[11px] text-slate-700 shadow-sm">
                  Plot {layout.plot.lengthFt} × {layout.plot.widthFt} ft
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <Step3
              layout={layout}
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
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
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
                Preview →
              </button>
            )}
            {step === 3 && (
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
                    : selectedFormatCount(sendFormats) === 1
                      ? "📤 Send to WhatsApp"
                      : `📤 Send ${selectedFormatCount(sendFormats)} items`}
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

function Step1(props: {
  customerName: string;
  setCustomerName: (v: string) => void;
  lengthFt: number;
  setLengthFt: (v: number) => void;
  widthFt: number;
  setWidthFt: (v: number) => void;
  selectedSports: Sport[];
  setSelectedSports: (v: Sport[]) => void;
  footballASide: 5 | 7 | 11;
  setFootballASide: (v: 5 | 7 | 11) => void;
  cricketLengthPreset: 22 | 16 | 12 | "custom";
  setCricketLengthPreset: (v: 22 | 16 | 12 | "custom") => void;
  cricketLengthCustom: number;
  setCricketLengthCustom: (v: number) => void;
  cricketOrientation: "horizontal" | "vertical";
  setCricketOrientation: (v: "horizontal" | "vertical") => void;
  basketballHalfCourt: boolean;
  setBasketballHalfCourt: (v: boolean) => void;
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
    cricketLengthPreset,
    setCricketLengthPreset,
    cricketLengthCustom,
    setCricketLengthCustom,
    cricketOrientation,
    setCricketOrientation,
    basketballHalfCourt,
    setBasketballHalfCourt,
  } = props;

  function toggleSport(sport: Sport) {
    setSelectedSports(
      selectedSports.includes(sport)
        ? selectedSports.filter((s) => s !== sport)
        : [...selectedSports, sport]
    );
  }

  const showFootballConfig = selectedSports.includes("football");
  const showCricketConfig = selectedSports.includes("cricket");
  const showBasketballConfig = selectedSports.includes("basketball");

  // Display values are the user-facing unit; storage stays in feet.
  // Rounded to 1 decimal for meters, 0 for feet.
  const displayLen = unit === "ft" ? lengthFt : Number(toUnit(lengthFt, unit).toFixed(1));
  const displayWid = unit === "ft" ? widthFt : Number(toUnit(widthFt, unit).toFixed(1));

  return (
    <div className="p-6 sm:p-8 overflow-y-auto h-full max-w-3xl mx-auto space-y-6">
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
        <DimensionPresets
          sports={selectedSports}
          unit={unit}
          onPick={(p) => {
            setLengthFt(Math.round(p.lengthFt));
            setWidthFt(Math.round(p.widthFt));
          }}
        />
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
              {[5, 7, 11].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFootballASide(s as 5 | 7 | 11)}
                  className={`flex-1 px-3 py-2 text-sm rounded border ${
                    footballASide === s
                      ? "border-wa-green bg-wa-green/10 text-wa-dark"
                      : "border-slate-300 text-slate-600 hover:bg-white"
                  }`}
                >
                  {s}-a-side
                </button>
              ))}
            </div>
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
              Pitch length
            </span>
            <div className="flex gap-2 mt-1">
              {[
                { label: "22 yd (regulation)", v: 22 as const },
                { label: "16 yd (junior)", v: 16 as const },
                { label: "12 yd (compact)", v: 12 as const },
                { label: "Custom", v: "custom" as const },
              ].map((opt) => (
                <button
                  key={String(opt.v)}
                  type="button"
                  onClick={() => setCricketLengthPreset(opt.v)}
                  className={`flex-1 px-2 py-2 text-xs rounded border ${
                    cricketLengthPreset === opt.v
                      ? "border-wa-green bg-wa-green/10 text-wa-dark"
                      : "border-slate-300 text-slate-600 hover:bg-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {cricketLengthPreset === "custom" && (
            <label className="block">
              <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                Custom length (yards)
              </span>
              <input
                type="number"
                min={5}
                max={30}
                value={cricketLengthCustom}
                onChange={(e) =>
                  setCricketLengthCustom(parseFloat(e.target.value) || 0)
                }
                className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </label>
          )}
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
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={basketballHalfCourt}
              onChange={(e) => setBasketballHalfCourt(e.target.checked)}
            />
            Half-court only (e.g. driveway / shorter plot)
          </label>
        </section>
      )}

      <div className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg p-3 leading-relaxed">
        ℹ️ In the next step you can drag, resize and rotate everything — change the
        pitch position, swap colors, add labels, etc. Initial layout is just a
        starting point.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Step 3 — preview + send
// ─────────────────────────────────────────────────────────────────────

function Step3({
  layout,
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
        <div className="flex-1 relative">
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
      <div className="border-l border-slate-200 p-5 overflow-y-auto space-y-5">
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

        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">
            What to send <span className="text-xs font-normal text-slate-500">({total} selected)</span>
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

function StepDots({ current }: { current: 1 | 2 | 3 }) {
  const labels = ["Sports", "Design", "Send"];
  return (
    <div className="flex items-center gap-2 text-xs">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
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
            {n < 3 && <span className="text-slate-300">·</span>}
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
  onPick,
}: {
  sports: Sport[];
  unit: "ft" | "m";
  onPick: (p: CourtPreset) => void;
}) {
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
                  key={p.label}
                  type="button"
                  onClick={() => onPick(p)}
                  className="text-left px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded hover:border-wa-green hover:bg-wa-green/5 transition"
                >
                  <div className="font-medium text-slate-900 leading-tight">
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
