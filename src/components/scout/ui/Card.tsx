import type { ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  dark?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Card({ title, eyebrow, footer, dark = false, children, className }: CardProps) {
  return (
    <div
      className={[
        "flex flex-col gap-3 p-5 font-sans rounded-xl border",
        dark ? "bg-black text-white border-slate-700 shadow-none" : "bg-white text-slate-900 shadow-md",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {eyebrow ? (
        <div className="font-heading uppercase tracking-[0.13em] text-[11px] text-court-500">
          {eyebrow}
        </div>
      ) : null}
      {title ? <div className="text-lg font-semibold leading-[1.3]">{title}</div> : null}
      <div className={dark ? "text-sm leading-normal text-slate-300" : "text-sm leading-normal text-slate-500"}>
        {children}
      </div>
      {footer ? <div className="mt-auto pt-2">{footer}</div> : null}
    </div>
  );
}
