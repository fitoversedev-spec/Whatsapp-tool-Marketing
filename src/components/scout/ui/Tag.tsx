"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface TagProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  selected?: boolean;
  children: ReactNode;
}

export function Tag({ selected = false, children, className, ...rest }: TagProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[
        "inline-flex items-center gap-1.5 font-sans text-[13px] font-medium py-1.5 px-3.5 rounded-full cursor-pointer border transition-colors duration-150 ease-in-out",
        selected
          ? "border-court-500 bg-court-500 text-white"
          : "border-slate-300 bg-transparent text-slate-900 hover:bg-slate-100",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
