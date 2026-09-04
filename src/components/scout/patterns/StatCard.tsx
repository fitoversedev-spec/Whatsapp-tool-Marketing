import type { ReactNode } from "react";

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Dark #0a0a0a variant — the fourth card in the 2x2 grids. */
  inverted?: boolean;
  /** `md` is the D2/mobile-02 24px numeral; `sm` is the D1 card 20px numeral. */
  size?: "sm" | "md";
  /** Blue-700 numeral, used for the demand figure on the D1 scan cards. */
  accent?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  inverted = false,
  size = "md",
  accent = false,
  className,
}: StatCardProps) {
  const valueSizeClass =
    size === "sm" ? "text-xl mt-[3px]" : "text-2xl mt-[7px]";
  const labelSizeClass =
    size === "sm"
      ? "text-[10.5px] tracking-[0.08em] font-normal"
      : "text-[10px] tracking-[0.1em] font-bold";

  return (
    <div
      className={[
        "border rounded-[12px] p-[13px] font-sans",
        inverted ? "bg-black text-white border-black" : "bg-white",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "uppercase",
          labelSizeClass,
          inverted ? "text-white/55" : "text-slate-500",
        ].join(" ")}
      >
        {label}
      </div>
      <div
        className={[
          "font-display font-bold leading-tight",
          valueSizeClass,
          accent && "text-court-700",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </div>
    </div>
  );
}
