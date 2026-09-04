import type { ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";

export interface ScreenScaffoldProps {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * The desktop scroll-screen frame (32px 40px 48px, 20px gap) shared by D1–D5.
 * Phase 0 ships the layout only; the phases that own each screen fill it.
 */
export function ScreenScaffold({ eyebrow, title, lede, actions, children }: ScreenScaffoldProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pt-8 px-10 pb-12 flex flex-col gap-5 max-[900px]:pt-5 max-[900px]:px-[18px] max-[900px]:pb-6 max-[900px]:gap-[22px] ss-scroll ssIn">
      <div className="flex items-baseline justify-between gap-5 flex-wrap">
        <div>
          {eyebrow ? <SectionLabel>{eyebrow}</SectionLabel> : null}
          <h1 className="m-0 text-xl">{title}</h1>
          {lede ? (
            <div className="text-[13px] text-slate-500 mt-2 tracking-normal normal-case font-sans">
              {lede}
            </div>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export interface PhasePlaceholderProps {
  phase: string;
  children: ReactNode;
}

/**
 * Marks a screen that intentionally has no functionality yet, naming the phase
 * that fills it. Better than an empty page: it is obvious to a reviewer that
 * this is scaffolding rather than a broken screen.
 */
export function PhasePlaceholder({ phase, children }: PhasePlaceholderProps) {
  return (
    <div className="border border-dashed border-slate-300 rounded-[16px] bg-white p-6 flex flex-col gap-3 items-start">
      <SectionLabel weight={700}>Arrives in {phase}</SectionLabel>
      <p className="text-[13.5px] text-slate-500 leading-snug max-w-[62ch] m-0">{children}</p>
    </div>
  );
}
