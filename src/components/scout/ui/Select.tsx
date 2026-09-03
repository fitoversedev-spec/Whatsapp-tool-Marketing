"use client";

import { useId, type SelectHTMLAttributes } from "react";
import styles from "./Select.module.css";

export type SelectOption = string | { value: string; label: string };

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label?: string;
  options?: SelectOption[];
  id?: string;
  wrapClassName?: string;
}

export function Select({
  label,
  options = [],
  id,
  className,
  wrapClassName,
  ...rest
}: SelectProps) {
  const generated = useId();
  const selectId = id ?? generated;

  return (
    <div className={[styles.wrap, wrapClassName].filter(Boolean).join(" ")}>
      {label ? (
        <label className={styles.label} htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={[styles.select, className].filter(Boolean).join(" ")}
        {...rest}
      >
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ),
        )}
      </select>
    </div>
  );
}
