"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Tag.module.css";

export interface TagProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  selected?: boolean;
  children: ReactNode;
}

export function Tag({ selected = false, children, className, ...rest }: TagProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[styles.tag, selected && styles.selected, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
