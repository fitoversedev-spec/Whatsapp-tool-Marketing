import type { CSSProperties } from "react";

export interface SkeletonProps {
  /** Any CSS length. Defaults to filling its container. */
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

/**
 * A loading placeholder.
 *
 * `aria-hidden` on purpose: the shimmer says nothing a screen reader can use.
 * Every block that shows skeletons announces its state through a live region
 * instead — see `SkeletonBlock`.
 */
export function Skeleton({ width, height = "1em", radius, className }: SkeletonProps) {
  const style: CSSProperties = {};
  if (width) style.width = width;
  if (height) style.height = height;
  if (radius) style.borderRadius = radius;
  return (
    <span
      aria-hidden="true"
      className={[
        "block bg-slate-200 rounded animate-pulse motion-reduce:animate-none",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    />
  );
}

export interface SkeletonBlockProps {
  /** Announced to assistive technology while the block is loading. */
  label: string;
  lines?: number;
  className?: string;
}

/** A few skeleton lines plus the polite announcement that goes with them. */
export function SkeletonBlock({ label, lines = 3, className }: SkeletonBlockProps) {
  return (
    <div
      className={["flex flex-col gap-[9px] w-full", className].filter(Boolean).join(" ")}
    >
      <span role="status" className="srOnly">
        {label}
      </span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height="14px" width={i === lines - 1 ? "62%" : "100%"} radius="6px" />
      ))}
    </div>
  );
}
