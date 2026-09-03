"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Sheet.module.css";

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
      <button type="button" className={styles.scrim} aria-label="Close" onClick={onClose} />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <span className={styles.grabber} aria-hidden="true" />
          <h2 className={styles.heading} id={headingId}>
            {heading}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
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
        <div className={styles.body}>{children}</div>
      </div>
    </>
  );
}
