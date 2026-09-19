"use client";

export interface AnalysisProgressProps {
  total: number;
  completed: number;
  failed: number;
  status: string;
  className?: string;
}

export function AnalysisProgress({ total, completed, failed, status, className }: AnalysisProgressProps) {
  const pct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
  const isRunning = status === "running" || status === "pending";

  return (
    <div
      className={[
        "rounded-lg border border-slate-200 bg-white px-4 py-3.5",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <svg className="animate-spin h-4 w-4 text-court-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : null}
          <span className="text-[13px] font-semibold text-slate-800">
            {status === "completed"
              ? "Analysis complete"
              : status === "failed"
                ? "Analysis failed"
                : status === "partial"
                  ? "Partial results"
                  : "Analysing places…"}
          </span>
        </div>
        <span className="text-[12px] text-slate-500">
          {completed}/{total} done{failed > 0 ? ` · ${failed} failed` : ""}
        </span>
      </div>

      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={[
            "h-full rounded-full transition-all duration-300",
            failed > 0 && completed === 0
              ? "bg-red-400"
              : status === "completed"
                ? "bg-court-500"
                : "bg-court-400",
          ].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>

      {isRunning ? (
        <p className="m-0 mt-2 text-[11.5px] text-slate-400">
          Places are analysed in batches of 3. This may take a few minutes.
        </p>
      ) : null}
    </div>
  );
}
