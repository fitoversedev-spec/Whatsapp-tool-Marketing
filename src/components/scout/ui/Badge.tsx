import type { ReactNode } from "react";

/**
 * Tone names match the design-system bundle. `dark` is present in the bundle
 * and used by the screens, so it is kept even though the brief lists four.
 */
export type BadgeTone = "neutral" | "green" | "blue" | "red" | "dark";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const toneClass: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  blue: "bg-court-50 text-court-700",
  green: "bg-green-100 text-green-600",
  red: "bg-red-100 text-red-600",
  dark: "bg-black text-white",
};

export function Badge({ tone = "blue", children, className }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 font-sans text-xs font-semibold py-[3px] px-2.5 rounded-full",
        toneClass[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
