import type { ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";
import styles from "./ScreenScaffold.module.css";

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
    <div className={`${styles.screen} ss-scroll ssIn`}>
      <div className={styles.head}>
        <div>
          {eyebrow ? <SectionLabel>{eyebrow}</SectionLabel> : null}
          <h1 className={styles.title}>{title}</h1>
          {lede ? <div className={styles.lede}>{lede}</div> : null}
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
    <div className={styles.placeholder}>
      <SectionLabel weight={700}>Arrives in {phase}</SectionLabel>
      <p className={styles.placeholderBody}>{children}</p>
    </div>
  );
}
