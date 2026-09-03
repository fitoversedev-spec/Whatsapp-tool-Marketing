import type { CSSProperties } from "react";
import styles from "./Skeleton.module.css";

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
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
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
    <div className={[styles.block, className].filter(Boolean).join(" ")}>
      <span role="status" className="srOnly">
        {label}
      </span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height="14px" width={i === lines - 1 ? "62%" : "100%"} radius="6px" />
      ))}
    </div>
  );
}
