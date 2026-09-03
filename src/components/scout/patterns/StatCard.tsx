import type { ReactNode } from "react";
import styles from "./StatCard.module.css";

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Dark #0a0a0a variant — the fourth card in the 2x2 grids. */
  inverted?: boolean;
  /** `md` is the D2/mobile-02 24px numeral; `sm` is the D1 card 20px numeral. */
  size?: "sm" | "md";
  /** Blue-700 numeral, used for the demand figure on the D1 scan cards. */
  accent?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  inverted = false,
  size = "md",
  accent = false,
  className,
}: StatCardProps) {
  return (
    <div
      className={[
        styles.card,
        styles[size],
        inverted && styles.inverted,
        accent && styles.accent,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  );
}
