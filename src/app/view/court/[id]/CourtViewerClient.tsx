"use client";

// Full-screen interactive 3D court viewer for customers. Reuses the
// same CourtCanvas3D the sales team designs with — it has orbit
// controls built in (drag to rotate, scroll/pinch to zoom). View
// preset buttons (Orbit / Top / Iso / Side) reframe the camera.
//
// P6-05 — branded chrome: Fitoverse-green header + logo, a Day/Evening/Night
// toggle that re-lights the scene (so floodlit designs demo their masts), and
// a share button (native share sheet, clipboard fallback).

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CourtLayout } from "@/lib/court-image/schema";
import type {
  CourtCanvas3DHandle,
  CourtView,
} from "@/components/court-image/CourtCanvas3D";

const CourtCanvas3D = dynamic(
  () => import("@/components/court-image/CourtCanvas3D"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-300 text-sm">
        Loading 3D view…
      </div>
    ),
  },
);

type TimeOfDay = NonNullable<CourtLayout["style"]["timeOfDay"]>;

export default function CourtViewerClient({
  layout,
  customerName,
  number,
}: {
  layout: CourtLayout;
  customerName: string;
  number: string;
}) {
  const handleRef = useRef<CourtCanvas3DHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CourtView>("orbit");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(
    layout.style.timeOfDay ?? "day",
  );
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState({ width: 800, height: 500 });

  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (!el) return;
      setSize({ width: el.clientWidth, height: el.clientHeight });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Re-light the scene by handing the 3D canvas a layout with the chosen
  // time-of-day. A fresh object triggers the canvas's layout-rebuild effect,
  // which re-applies the lighting profile (and floodlight beam levels).
  const viewLayout = useMemo<CourtLayout>(
    () => ({ ...layout, style: { ...layout.style, timeOfDay } }),
    [layout, timeOfDay],
  );

  const views: Array<{ id: CourtView; label: string }> = [
    { id: "orbit", label: "Orbit" },
    { id: "top", label: "Top" },
    { id: "iso", label: "Iso" },
    { id: "side", label: "Side" },
  ];
  const times: Array<{ id: TimeOfDay; label: string }> = [
    { id: "day", label: "Day" },
    { id: "evening", label: "Evening" },
    { id: "night", label: "Night" },
  ];

  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const title = `${customerName || "Court design"} — Fitoverse`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      /* user cancelled the native sheet — fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — nothing more we can do silently */
    }
  }

  const pill = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-md transition ${
      active
        ? "bg-white text-[#159341] font-semibold shadow-sm"
        : "bg-white/15 text-white/90 hover:bg-white/25"
    }`;

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-white">
      {/* Brand header */}
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#159341] shrink-0 shadow-md">
        <div className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/quotation-assets/image1.png"
            alt="Fitoverse"
            className="h-7 w-auto shrink-0 drop-shadow"
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate leading-tight">
              {customerName || "Court design"}
            </div>
            <div className="text-[11px] text-white/80 leading-tight">
              {number} · drag to rotate, scroll to zoom
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex gap-1">
            {times.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTimeOfDay(t.id)}
                className={pill(timeOfDay === t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {views.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={pill(view === v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={share}
            className="px-2.5 py-1 text-xs rounded-md bg-white text-[#159341] font-semibold hover:bg-white/90 transition"
          >
            {copied ? "Link copied" : "Share"}
          </button>
        </div>
      </header>

      {/* Time-of-day toggle on small screens (header hides it) */}
      <div className="sm:hidden flex justify-center gap-1 py-1.5 bg-[#127e39] shrink-0">
        {times.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTimeOfDay(t.id)}
            className={pill(timeOfDay === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 3D canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        <CourtCanvas3D
          layout={viewLayout}
          canvasWidth={size.width}
          canvasHeight={size.height}
          handleRef={handleRef}
          view={view}
        />
      </div>

      {/* Footer */}
      <footer className="px-4 py-2 text-center text-[11px] text-slate-400 border-t border-slate-700 shrink-0">
        Fitoverse Sports Infrastructure · +91 93638 63382
      </footer>
    </div>
  );
}
