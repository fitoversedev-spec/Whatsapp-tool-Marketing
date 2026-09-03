import type { ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  dark?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Card({ title, eyebrow, footer, dark = false, children, className }: CardProps) {
  return (
    <div className={[styles.card, dark && styles.dark, className].filter(Boolean).join(" ")}>
      {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
      {title ? <div className={styles.title}>{title}</div> : null}
      <div className={styles.body}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}
