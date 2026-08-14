"use client";

// The floating "Ask AI" panel: the sales-data Q&A (AiReportTab) in a dockable,
// minimizable card that coexists with the team chat. Mirrors ChatPanel's shell
// (header + minimize/close, fixed bottom-right, full-screen on mobile) but docks
// to the LEFT of the chat panel on desktop so both can be open at once — read a
// rep's report while messaging that rep. State lives inside AiReportTab, so
// "minimize" (parent CSS-hides this) preserves the question and report.
import AiReportTab from "@/components/analytics/AiReportTab";

export default function AiPanel({
  onMinimize,
  onClose,
}: {
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed z-50 flex flex-col bg-white shadow-2xl border border-slate-200 right-[404px] bottom-4 w-[440px] h-[600px] rounded-2xl max-lg:right-4 max-sm:inset-0 max-sm:w-full max-sm:h-full max-sm:rounded-none">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200 shrink-0">
        <span aria-hidden className="text-lg leading-none">✨</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">Ask AI</div>
          <div className="text-[10px] text-slate-400">Your sales data — real numbers only</div>
        </div>
        <button onClick={onMinimize} title="Minimize" className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 leading-none">—</button>
        <button onClick={onClose} title="Close" className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 text-base leading-none">✕</button>
      </div>

      {/* Body — scrolls; white AiReportTab cards sit on a slate wash. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-slate-50">
        <AiReportTab />
      </div>
    </div>
  );
}
