import type { ReactNode } from "react";
import styles from "./Badge.module.css";

/**
 * Tone names match the design-system bundle. `dark` is present in the bundle
 * and used by the screens, so it is kept even though the brief lists four.
 */
export type BadgeTone = "neutral" | "green" | "blue" | "red" | "dark";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "blue", children, className }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[tone], className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
