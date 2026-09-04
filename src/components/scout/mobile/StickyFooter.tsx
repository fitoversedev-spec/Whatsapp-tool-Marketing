import type { ReactNode } from "react";


export interface StickyFooterProps {
  /** Optional line above the CTA (cost band, resume prompt, offline notice). */
  note?: ReactNode;
  children: ReactNode;
}

/**
 * One job per screen, and its action lives in the bottom third where a thumb
 * reaches. Every phone screen in the mockup ends in one of these.
 */
export function StickyFooter({ note, children }: StickyFooterProps) {
  return (
    <div className="flex-none z-10 px-[var(--m-pad-x)] pb-[var(--m-safe-bottom)] pt-3 bg-[var(--sticky-footer-bg)] backdrop-blur-[8px] border-t border-[color:var(--border-default)] flex flex-col gap-2.5">
      {note ? <p className="text-[length:var(--text-11-5)] text-[color:var(--m-muted)] leading-[1.45] text-center">{note}</p> : null}
      {children}
    </div>
  );
}
