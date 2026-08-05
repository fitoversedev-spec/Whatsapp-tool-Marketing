"use client";

// Global "Ask AI" launcher — a top-bar button on every dashboard page that
// opens the sales-data Q&A (AiReportTab) in a modal. The report route is scoped
// per user (admins → company-wide, reps → their own deals only), so it's safe
// to show to everyone. Internal-assist only: read-only reporting, real numbers.
import { useState, useEffect } from "react";
import AiReportTab from "@/components/analytics/AiReportTab";

export default function AskAiLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Floating circular launcher — mirrors the team-chat bubble's style and
          sits just above it (chat is bottom-4; this is bottom-20). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask AI"
        title="Ask AI about your sales data"
        className="fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-wa-green hover:bg-wa-green/90 text-white shadow-lg flex items-center justify-center text-2xl transition"
      >
        ✨
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl my-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
                  <span aria-hidden>✨</span> Ask AI
                </h2>
                <p className="text-xs text-slate-500">
                  Ask anything about your sales data — real numbers only.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <AiReportTab />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
