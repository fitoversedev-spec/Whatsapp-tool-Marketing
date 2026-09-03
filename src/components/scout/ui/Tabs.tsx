"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import styles from "./Tabs.module.css";

export interface TabsProps {
  tabs: string[];
  /** Index of the active tab. Defaults to 0, matching the bundle. */
  active?: number;
  onChange?: (index: number) => void;
  className?: string;
  /** Accessible name for the tab list. */
  label?: string;
}

export function Tabs({ tabs, active = 0, onChange, className, label = "Tabs" }: TabsProps) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (tabs.length === 0) return;
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (active + delta + tabs.length) % tabs.length;
    onChange?.(next);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={[styles.tabs, className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
    >
      {tabs.map((t, i) => (
        <button
          key={t}
          id={`${base}-tab-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={i === active}
          tabIndex={i === active ? 0 : -1}
          className={[styles.tab, i === active && styles.active].filter(Boolean).join(" ")}
          onClick={() => onChange?.(i)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
