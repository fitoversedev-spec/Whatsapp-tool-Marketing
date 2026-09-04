import type { ReactNode } from "react";
import PageHeader from "@/components/PageHeader";

export interface ScreenScaffoldProps {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function ScreenScaffold({ title, lede, actions, children }: ScreenScaffoldProps) {
  return (
    <>
      <PageHeader title={title} description={lede} action={actions} hideBack />
      <div className="p-4 sm:p-6 max-w-5xl space-y-5">
        {children}
      </div>
    </>
  );
}

export interface PhasePlaceholderProps {
  phase: string;
  children: ReactNode;
}

export function PhasePlaceholder({ phase, children }: PhasePlaceholderProps) {
  return (
    <div className="border border-dashed border-slate-300 rounded-xl bg-white p-6 flex flex-col gap-3 items-start">
      <div className="text-[11px] font-bold tracking-[0.13em] uppercase text-slate-500">Arrives in {phase}</div>
      <p className="text-sm text-slate-500 leading-snug max-w-[62ch] m-0">{children}</p>
    </div>
  );
}
