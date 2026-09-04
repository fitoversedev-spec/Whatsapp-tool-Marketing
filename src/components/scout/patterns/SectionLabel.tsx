import type { ElementType, ReactNode } from "react";

export interface SectionLabelProps {
  children: ReactNode;
  /** The mockups use both 600 and 700 for this recipe. */
  weight?: 600 | 700;
  /** Muted-on-dark variant: rgba(255,255,255,.55). */
  onDark?: boolean;
  as?: ElementType;
  className?: string;
}

export function SectionLabel({
  children,
  weight = 600,
  onDark = false,
  as: Tag = "div",
  className,
}: SectionLabelProps) {
  return (
    <Tag
      className={[
        "font-sans text-xs font-semibold uppercase tracking-wider",
        weight === 700 ? "font-bold" : "font-semibold",
        onDark ? "text-white/55" : "text-slate-500",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Tag>
  );
}
