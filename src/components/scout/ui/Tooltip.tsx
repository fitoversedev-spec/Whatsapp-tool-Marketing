"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}

/**
 * Shows on hover (as in the bundle) and additionally on focus, so the tooltip
 * is reachable by keyboard. `aria-describedby` wires it to the trigger.
 */
export function Tooltip({ label, side = "top", children }: TooltipProps) {
  const [show, setShow] = useState(false);
  const id = useId();

  return (
    <span
      className={styles.wrap}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      aria-describedby={show ? id : undefined}
    >
      {children}
      {show ? (
        <span id={id} role="tooltip" className={`${styles.bubble} ${styles[side]}`}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
