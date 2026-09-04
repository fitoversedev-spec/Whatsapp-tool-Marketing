"use client";

import { useId, useState, type ReactNode } from "react";

export interface TooltipProps {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}

const sideClass: Record<"top" | "bottom", string> = {
  top: "bottom-[calc(100%+8px)]",
  bottom: "top-[calc(100%+8px)]",
};

/**
 * Shows on hover (as in the bundle) and additionally on focus, so the tooltip
 * is reachable by keyboard. `aria-describedby` wires it to the trigger.
 */
export function Tooltip({ label, side = "top", children }: TooltipProps) {
  const [show, setShow] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      aria-describedby={show ? id : undefined}
    >
      {children}
      {show ? (
        <span
          id={id}
          role="tooltip"
          className={`absolute left-1/2 -translate-x-1/2 bg-black text-white font-sans text-xs font-medium py-1.5 px-2.5 rounded-sm whitespace-nowrap z-[100] shadow-md ${sideClass[side]}`}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
