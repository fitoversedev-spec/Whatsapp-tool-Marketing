"use client";

import { useState, useEffect, useRef } from "react";
import type { GuideEntry } from "@/lib/help/types";
import GuideSteps from "./GuideSteps";
import GuideScreenshot from "./GuideScreenshot";

type Props = {
  entry: GuideEntry;
  defaultOpen?: boolean;
};

export default function GuideCard({ entry, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (defaultOpen && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [defaultOpen]);

  return (
    <div
      ref={ref}
      id={`guide-${entry.slug}`}
      className="card overflow-hidden transition-shadow hover:shadow-sm"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        <div className="shrink-0 w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-heading font-bold text-sm text-slate-900 truncate">
              {entry.title}
            </span>
            <span className="shrink-0 badge bg-slate-100 text-slate-600 text-[10px]">
              {entry.category}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{entry.summary}</p>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-4">
          <GuideSteps steps={entry.steps} />
          <GuideScreenshot file={entry.screenshot.file} alt={entry.screenshot.alt} />
        </div>
      )}
    </div>
  );
}
