"use client";

import { useId, type InputHTMLAttributes } from "react";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label?: string;
  hint?: string;
  error?: string;
  id?: string;
  wrapClassName?: string;
}

export function Input({ label, hint, error, id, className, wrapClassName, ...rest }: InputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const messageId = `${inputId}-message`;
  const hasMessage = Boolean(error ?? hint);

  return (
    <div
      className={["flex flex-col gap-1.5 font-sans text-[13px] text-slate-900", wrapClassName]
        .filter(Boolean)
        .join(" ")}
    >
      {label ? (
        <label className="font-semibold" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={[
          "font-sans text-sm py-2.5 px-3.5 rounded-md border outline-none transition-shadow duration-150 ease-in-out bg-white text-slate-900",
          error
            ? "border-track-500 focus:border-track-500 focus:ring-2 focus:ring-track-500/20"
            : "border-slate-300 focus:border-court-500 focus:ring-2 focus:ring-court-500/20",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={hasMessage ? messageId : undefined}
        {...rest}
      />
      {error ? (
        <span id={messageId} className="text-track-500" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={messageId} className="text-slate-500">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
