import type { ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";
import styles from "./StateBlock.module.css";

export interface StateBlockProps {
  /** Small uppercase label above the headline. */
  eyebrow?: string;
  title: string;
  /** What happened, and — for an error — what to do about it. */
  body: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "error";
  className?: string;
}

/**
 * Empty and error states.
 *
 * One component for both because they differ only in tone: an empty state says
 * "there is nothing here yet and here is how to start", an error state says
 * "this failed, here is what failed and here is what to do". Neither is ever
 * allowed to be a bare "Something went wrong" — that tells the surveyor
 * nothing they can act on in the field.
 */
export function StateBlock({
  eyebrow,
  title,
  body,
  action,
  tone = "neutral",
  className,
}: StateBlockProps) {
  return (
    <div
      className={[styles.block, tone === "error" && styles.error, className]
        .filter(Boolean)
        .join(" ")}
      role={tone === "error" ? "alert" : undefined}
    >
      {eyebrow ? <SectionLabel weight={700}>{eyebrow}</SectionLabel> : null}
      <div className={styles.title}>{title}</div>
      <div className={styles.body}>{body}</div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
