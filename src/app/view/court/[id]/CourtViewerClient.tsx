"use client";

// Full-screen interactive 3D court viewer for customers. Reuses the
// same CourtCanvas3D the sales team designs with — it has orbit
// controls built in (drag to rotate, scroll/pinch to zoom). View
// preset buttons (Orbit / Top / Iso / Side) reframe the camera.

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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

  const views: Array<{ id: CourtView; label: string }> = [
    { id: "orbit", label: "Orbit" },
    { id: "top", label: "Top" },
    { id: "iso", label: "Iso" },
    { id: "side", label: "Side" },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">
            {customerName || "Court design"}
          </div>
          <div className="text-[11px] text-slate-400">
            Fitoverse · {number} · drag to rotate, scroll to zoom
          </div>
        </div>
        <div className="flex gap-1">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`px-2.5 py-1 text-xs rounded-md transition ${
                view === v.id
                  ? "bg-white text-slate-900"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </header>

      {/* 3D canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        <CourtCanvas3D
          layout={layout}
          canvasWidth={size.width}
          canvasHeight={size.height}
          handleRef={handleRef}
          view={view}
        />
      </div>

      {/* Footer */}
      <footer className="px-4 py-2 text-center text-[11px] text-slate-500 border-t border-slate-700 shrink-0">
        Fitoverse Sports Infrastructure · +91 93638 63382
      </footer>
    </div>
  );
}
