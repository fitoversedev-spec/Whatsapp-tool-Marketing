"use client";

export interface StepBarProps {
  steps: readonly string[];
  current: number;
  onStep?: (index: number) => void;
  className?: string;
}

export function StepBar({ steps, current, onStep, className }: StepBarProps) {
  return (
    <nav
      aria-label="Wizard progress"
      className={["flex items-center gap-0", className].filter(Boolean).join(" ")}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = done && !!onStep;

        return (
          <button
            key={label}
            type="button"
            disabled={!clickable}
            aria-current={active ? "step" : undefined}
            onClick={() => clickable && onStep?.(i)}
            className={[
              "flex-1 flex flex-col items-center gap-1 py-2 border-0 bg-transparent cursor-default transition-colors",
              clickable ? "cursor-pointer hover:bg-slate-50" : "",
            ].join(" ")}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={[
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors",
                  done
                    ? "bg-court-500 text-white"
                    : active
                      ? "bg-court-500 text-white ring-2 ring-court-300"
                      : "bg-slate-200 text-slate-500",
                ].join(" ")}
              >
                {done ? (
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.5L5 9l4.5-6" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={[
                  "hidden md:inline text-[11px] font-semibold tracking-wide uppercase whitespace-nowrap",
                  done ? "text-court-600" : active ? "text-slate-900" : "text-slate-400",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            <span
              className={[
                "md:hidden text-[9px] font-semibold tracking-wide uppercase",
                done ? "text-court-600" : active ? "text-slate-900" : "text-slate-400",
              ].join(" ")}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
