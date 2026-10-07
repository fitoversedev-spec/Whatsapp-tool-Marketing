"use client";

// Global "Ask AI" launcher — a floating ✨ bubble on every dashboard page that
// opens the sales-data Q&A (AiReportTab) in a dockable, minimizable panel. The
// panel is non-blocking and docks to the LEFT of the team-chat panel, so it can
// stay open ALONGSIDE the 💬 chat — ask about a rep's performance, read the
// report, and message that rep without closing either. Mirrors
// FloatingChatLauncher's mount/visible pattern: minimize hides the panel but
// keeps it mounted (state survives); close unmounts and resets. The report route
// is scoped per user (admins → company-wide, reps → their own deals only), so
// it's safe to show to everyone. Internal-assist only: read-only reporting.
import { useState } from "react";
import dynamic from "next/dynamic";

// The panel's code is only downloaded the first time someone opens it.
const AiPanel = dynamic(() => import("@/components/AiPanel"), {
  ssr: false,
  loading: () => (
    <div className="fixed z-50 flex items-center justify-center bg-white shadow-2xl border border-slate-200 inset-0 w-full h-full md:inset-auto md:right-4 md:bottom-4 md:w-[440px] md:h-[600px] md:rounded-2xl md:max-w-[calc(100vw-5rem)] lg:right-[404px] text-sm text-slate-400">
      Loading…
    </div>
  ),
});

export default function AskAiLauncher() {
  const [mounted, setMounted] = useState(false); // panel exists (open or minimized)
  const [visible, setVisible] = useState(false); // panel shown

  function openPanel() {
    setMounted(true);
    setVisible(true);
  }

  return (
    <>
      {/* Panel — kept mounted while minimized so AiReportTab's state survives;
          only rendered visible when open. */}
      {mounted && (
        <div className={visible ? "" : "hidden"}>
          <AiPanel
            onMinimize={() => setVisible(false)}
            onClose={() => {
              setVisible(false);
              setMounted(false);
            }}
          />
        </div>
      )}

      {/* Bubble — sits just above the 💬 chat bubble; hidden while the panel is
          open (like the chat launcher). */}
      {!visible && (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Ask AI"
          title="Ask AI about your sales data"
          className="fixed bottom-36 md:bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-wa-green hover:bg-wa-green/90 text-white shadow-lg flex items-center justify-center text-2xl transition"
        >
          ✨
        </button>
      )}
    </>
  );
}
