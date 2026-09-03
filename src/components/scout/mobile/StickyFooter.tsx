import type { ReactNode } from "react";
import styles from "./StickyFooter.module.css";

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
    <div className={styles.footer}>
      {note ? <p className={styles.note}>{note}</p> : null}
      {children}
    </div>
  );
}
