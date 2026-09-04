"use client";

import { useId, type SelectHTMLAttributes } from "react";

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
    <div
      className={["flex flex-col gap-1.5 font-sans text-[13px] text-slate-900", wrapClassName]
        .filter(Boolean)
        .join(" ")}
    >
      {label ? (
        <label className="font-semibold" htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={[
          "font-sans text-sm py-2.5 px-3.5 rounded-md border border-slate-300 bg-white text-slate-900 cursor-pointer focus-visible:border-court-500 focus-visible:ring-2 focus-visible:ring-court-500/20",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
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
