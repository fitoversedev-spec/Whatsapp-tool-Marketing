import type { ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";

export interface StateBlockProps {
  /** Small uppercase label above the headline. */
  eyebrow?: string;
  title: string;
  /** What happened, and — for an error — what to do about it. */
  body: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "error";
  className?: string;
}

/**
 * Empty and error states.
 *
 * One component for both because they differ only in tone: an empty state says
 * "there is nothing here yet and here is how to start", an error state says
 * "this failed, here is what failed and here is what to do". Neither is ever
 * allowed to be a bare "Something went wrong" — that tells the surveyor
 * nothing they can act on in the field.
 */
export function StateBlock({
  eyebrow,
  title,
  body,
  action,
  tone = "neutral",
  className,
}: StateBlockProps) {
  const isError = tone === "error";

  return (
    <div
      className={[
        "rounded-[16px] p-[22px] flex flex-col gap-2.5 items-start font-sans border",
        isError ? "border-track-500 bg-track-100" : "bg-white",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={isError ? "alert" : undefined}
    >
      {eyebrow ? <SectionLabel weight={700}>{eyebrow}</SectionLabel> : null}
      <div className={isError ? "text-[15px] font-semibold text-track-600" : "text-[15px] font-semibold text-slate-900"}>
        {title}
      </div>
      <div className={isError ? "text-[13.5px] leading-[1.65] max-w-[62ch] text-slate-700" : "text-[13.5px] leading-[1.65] max-w-[62ch] text-slate-500"}>
        {body}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
