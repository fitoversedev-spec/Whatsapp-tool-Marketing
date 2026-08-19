"use client";

// Shared quotation highlighter — used by BOTH the standalone quote wizard
// (/quotations) and the court-designer quotation step. Two modes: "Fill entire
// cell" (a solid colour behind the whole description cell) and tapping
// individual words. Word indices are computed on sanitize(text) — the SAME
// basis the PDF renderer uses — so painted words line up with the rendered
// highlight regardless of non-WinAnsi characters.

import { useState } from "react";
import { sanitize } from "@/lib/quotation/sanitize";

export type Highlights = {
  name?: Record<string, string>;
  description?: Record<string, string>;
  cell?: string;
} | null;

export const HIGHLIGHT_COLORS: { name: string; hex: string }[] = [
  { name: "Yellow", hex: "#fff3bf" },
  { name: "Green", hex: "#d3f9d8" },
  { name: "Pink", hex: "#ffdeeb" },
  { name: "Blue", hex: "#d0ebff" },
  { name: "Orange", hex: "#ffe8cc" },
];

function WordChips({
  label,
  text,
  map,
  onWord,
}: {
  label: string;
  text: string;
  map: Record<string, string> | undefined;
  onWord: (index: number) => void;
}) {
  const words = sanitize(text).split(/\s+/);
  const empty = words.length === 1 && words[0] === "";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      {empty ? (
        <span className="text-[11px] text-slate-400 italic">— empty —</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {words.map((w, i) =>
            w === "" ? null : (
              <button
                key={i}
                type="button"
                onClick={() => onWord(i)}
                className="text-sm leading-tight px-1 py-0.5 rounded border border-transparent hover:border-slate-300"
                style={{ background: map?.[String(i)] ?? "transparent" }}
              >
                {w}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default function ItemHighlighter({
  name,
  description,
  value,
  onChange,
}: {
  name: string;
  description: string;
  value?: Highlights;
  onChange: (next: Highlights) => void;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(HIGHLIGHT_COLORS[0].hex);

  const clean = (h: {
    name?: Record<string, string>;
    description?: Record<string, string>;
    cell?: string;
  }): Highlights => {
    const out: { name?: Record<string, string>; description?: Record<string, string>; cell?: string } = {};
    if (h.name && Object.keys(h.name).length) out.name = h.name;
    if (h.description && Object.keys(h.description).length) out.description = h.description;
    if (h.cell) out.cell = h.cell;
    return Object.keys(out).length ? out : null;
  };

  const paint = (field: "name" | "description", index: number) => {
    const cur = { ...(value?.[field] ?? {}) };
    const key = String(index);
    if (armed === null || cur[key] === armed) delete cur[key];
    else cur[key] = armed;
    onChange(clean({ ...value, [field]: cur }));
  };

  // "Entire cell" fill: one colour behind the whole cell. The eraser, or
  // clicking the already-set colour, clears it.
  const fillCell = () => {
    const next = armed === null || value?.cell === armed ? undefined : armed;
    onChange(clean({ ...value, cell: next }));
  };

  const clearAll = () => onChange(null);

  const hasAny =
    (value?.name && Object.keys(value.name).length) ||
    (value?.description && Object.keys(value.description).length) ||
    !!value?.cell;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span>🖍 Highlight</span>
        {hasAny ? <span className="text-court-600 font-semibold">• on</span> : null}
        <span className="text-slate-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-500">Colour:</span>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                onClick={() => setArmed(c.hex)}
                className={`w-6 h-6 rounded border ${armed === c.hex ? "ring-2 ring-court-500 border-court-500" : "border-slate-300"}`}
                style={{ background: c.hex }}
              />
            ))}
            <button
              type="button"
              title="Eraser"
              onClick={() => setArmed(null)}
              className={`w-6 h-6 rounded border bg-white text-xs flex items-center justify-center ${armed === null ? "ring-2 ring-court-500 border-court-500" : "border-slate-300"}`}
            >
              ⌫
            </button>
            {hasAny && (
              <button type="button" onClick={clearAll} className="text-xs text-track-600 hover:underline ml-auto">
                clear all
              </button>
            )}
          </div>

          {/* Mode 1 — entire-cell fill (solid colour behind the whole cell) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fillCell}
              className="text-sm font-medium rounded border border-slate-300 px-2.5 py-1 hover:bg-white"
              style={{ background: value?.cell ?? "#fff" }}
            >
              {value?.cell ? "Entire cell filled" : "Fill entire cell"}
            </button>
            <span className="text-xs text-slate-400">solid highlight</span>
          </div>

          {/* Mode 2 — tap individual words to highlight text */}
          <div className="space-y-2">
            <div className="text-xs text-slate-400">…or tap words to {armed === null ? "clear" : "highlight"}:</div>
            <WordChips label="Name" text={name} map={value?.name} onWord={(i) => paint("name", i)} />
            <WordChips label="Description" text={description} map={value?.description} onWord={(i) => paint("description", i)} />
          </div>
        </div>
      )}
    </div>
  );
}
