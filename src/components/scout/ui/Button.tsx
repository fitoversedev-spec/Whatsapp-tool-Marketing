"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "dark" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full-width CTA shape — mobile sticky footer and desktop side panels. */
  block?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const sizeClass: Record<ButtonSize, string> = {
  sm: "py-1.5 px-3.5 text-[13px]",
  md: "py-2.5 px-5 text-sm",
  lg: "py-3.5 px-7 text-base",
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-court-500 text-white border border-court-500",
  secondary: "bg-transparent text-slate-900 border border-slate-300",
  dark: "bg-black text-white border border-black",
  ghost: "bg-transparent text-court-500 border border-transparent",
  danger: "bg-track-500 text-white border border-track-500",
};

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  icon = null,
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const shapeClass = block
    ? "w-full justify-center rounded-lg py-[17px] px-5 text-[15.5px] font-bold"
    : `rounded-full ${sizeClass[size]}`;

  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center gap-2 font-sans font-semibold cursor-pointer transition-all duration-150 ease-in-out hover:enabled:brightness-[0.92] disabled:cursor-not-allowed disabled:opacity-45",
        shapeClass,
        variantClass[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
