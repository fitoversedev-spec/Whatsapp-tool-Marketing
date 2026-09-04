"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";


export interface SheetProps {
  open: boolean;
  onClose: () => void;
  heading: string;
  children: ReactNode;
}

/**
 * A bottom sheet.
 *
 * Field mode expands detail downward from the thumb rather than pushing to a
 * new route: the score breakdown and the surveyor checklist are things you read
 * *while* looking at the thing they explain, and a route change loses that.
 *
 * Focus is moved into the sheet on open and returned to the trigger on close,
 * and Escape closes it — a bottom sheet that traps a screen-reader user behind
 * the scrim is worse than no sheet.
 */
export function Sheet({ open, onClose, heading, children }: SheetProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    // Stop the page behind the sheet scrolling under the finger.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <style>{`@keyframes sheetUp{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}`}</style>
      <button type="button" className="fixed inset-0 z-40 border-0 p-0 bg-[rgba(10,10,10,0.35)] cursor-pointer" aria-label="Close" onClick={onClose} />
      <div
        className="fixed left-0 right-0 bottom-0 z-[41] max-h-[88dvh] flex flex-col bg-[var(--surface-card)] rounded-t-[18px] shadow-lg motion-reduce:!animate-none"
        style={{ animation: "sheetUp 0.22s var(--ease-standard)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="flex-none flex items-start gap-3 px-[var(--m-pad-x)] pt-4 pb-3 border-b border-[color:var(--border-default)]">
          <span className="absolute top-[7px] left-1/2 -translate-x-1/2 w-[38px] h-1 rounded-full bg-[var(--border-strong)]" aria-hidden="true" />
          <h2 className="flex-1 min-w-0 text-[length:var(--text-15)] font-semibold leading-[1.3] mt-1" id={headingId}>
            {heading}
          </h2>
          <button type="button" className="flex-none w-[var(--m-touch)] h-[var(--m-touch)] -mt-1.5 -mr-2 -mb-1.5 ml-0 border-0 bg-transparent text-[color:var(--m-muted)] rounded-full flex items-center justify-center cursor-pointer" onClick={onClose} aria-label="Close">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-[var(--m-pad-x)] pt-4 pb-[calc(20px+var(--m-safe-bottom))]">{children}</div>
      </div>
    </>
  );
}
