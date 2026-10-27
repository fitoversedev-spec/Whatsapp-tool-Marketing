"use client";

import type { ReactNode } from "react";
import type { AnalyticsSection } from "@/lib/website-analytics/types";
import type { ReadySection, SectionState } from "./useAnalyticsSection";
import { fmtNum, fmtShare, pctChange } from "./helpers";

// Small building blocks the Analytics tab's sections share: the card with its
// header, the loading / error / not-connected switch, the % change marker, the
// bar list and the scrolling table. Light/dark follows the slate ramp and the
// card class, like the rest of the app.

export function SectionCard({
  title,
  description,
  meta,
  children,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="text-sm text-slate-600 mt-0.5">{description}</p>}
        </div>
        {meta && <div className="text-xs text-slate-400 shrink-0 whitespace-nowrap">{meta}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Skeleton({ variant }: { variant: "tiles" | "list" | "chart" }) {
  const block = "rounded-lg bg-slate-200";
  return (
    <div className="animate-pulse space-y-3" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {variant === "tiles" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`${block} h-20`} />
            ))}
            <div className={`${block} h-20 col-span-2`} />
          </div>
          <div className={`${block} h-52`} />
        </>
      )}
      {variant === "chart" && <div className={`${block} h-48`} />}
      {variant === "list" &&
        [90, 72, 58, 44, 30].map((w, i) => <div key={i} className={`${block} h-4`} style={{ width: `${w}%` }} />)}
    </div>
  );
}

// Shows whichever state the section is in: skeleton, its own error with Try
// again, a not-connected note, or the content once the data is in.
export function SectionBody<S extends AnalyticsSection>({
  state,
  onRetry,
  skeleton = "list",
  notConnected,
  children,
}: {
  state: SectionState<S>;
  onRetry: () => void;
  skeleton?: "tiles" | "list" | "chart";
  notConnected?: ReactNode;
  children: (ready: ReadySection<S>) => ReactNode;
}) {
  switch (state.status) {
    case "loading":
      return <Skeleton variant={skeleton} />;
    case "error":
      return (
        <div className="text-sm text-center py-6">
          <p className="text-red-600 mb-3">{state.message}</p>
          <button type="button" onClick={onRetry} className="btn btn-secondary">
            Try again
          </button>
        </div>
      );
    case "not-connected":
      return (
        <p className="text-sm text-slate-500 py-2">
          {notConnected ?? "Google isn't connected yet, so there is nothing to show here."}
        </p>
      );
    case "ready":
      return <>{children(state)}</>;
  }
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500 py-4 text-center">{children}</p>;
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-700 mb-2">{children}</h3>;
}

/** % change against the previous period: green up, red down, "—" when there is nothing to compare with. */
export function Delta({ value, previous }: { value: number | null; previous: number | null }) {
  const change = pctChange(value, previous);
  if (change == null) {
    return (
      <span className="text-xs text-slate-400" title="No data for the previous period">
        —
      </span>
    );
  }
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) {
    return (
      <span className="text-xs text-slate-500" title="Same as the previous period">
        0%
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      className={`text-xs font-medium ${up ? "text-green-600" : "text-red-600"}`}
      title="Compared with the previous period"
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "Up" : "Down"}</span> {pct}%
    </span>
  );
}

export type BarItem = { label: string; value: number; color: string; note?: string };

// Plain horizontal bars with the numbers written on them, so they read on a
// phone without hovering. Bars are sized against the biggest row; pass `total`
// to also show each row's share of it.
export function BarList({ items, total }: { items: BarItem[]; total?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i, n) => (
        <li key={`${n}-${i.label}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-slate-700" title={i.label}>
              {i.label}
              {i.note && <span className="text-xs text-slate-400 ml-1.5">{i.note}</span>}
            </span>
            <span className="shrink-0 font-mono text-slate-900">
              {fmtNum(i.value)}
              {total ? <span className="text-xs text-slate-400 ml-1.5">{fmtShare(i.value / total)}</span> : null}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 mt-1 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: i.value > 0 ? `${Math.max(2, (i.value / max) * 100)}%` : 0, background: i.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// A table that scrolls sideways inside its card instead of widening the page.
// Columns after the first are numbers and line up on the right.
export function SimpleTable({
  columns,
  rows,
  minWidth = 320,
}: {
  columns: string[];
  rows: ReactNode[][];
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c} className={i > 0 ? "!text-right whitespace-nowrap" : "whitespace-nowrap"}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className={c > 0 ? "text-right font-mono whitespace-nowrap" : ""}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Long text in a table cell that stops at a sensible width and shows the whole text on hover. */
export function CellText({ children, title }: { children: string; title?: string }) {
  return (
    <span className="block max-w-[16rem] truncate" title={title ?? children}>
      {children}
    </span>
  );
}
