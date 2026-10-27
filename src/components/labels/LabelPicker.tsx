"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MetaLeadLabelChip } from "@/lib/meta-ads/queries";
import { LABEL_COLORS, labelChip, labelDot } from "@/lib/meta-ads/lead-fields";

// "+ Add label" button with a small popover: type to filter the shared label
// catalogue, click (or arrow keys + Enter) to pick one, or — when the typed name
// matches no label — create it (POST /api/ad-campaigns/labels, so it appears for
// ad leads and website leads too) and pick it. This only chooses a label: the caller
// applies it in onPick and decides what to save.

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200";

const NONE: string[] = [];
const byName = (a: MetaLeadLabelChip, b: MetaLeadLabelChip) => a.name.localeCompare(b.name);

export default function LabelPicker({
  catalogue,
  excludeIds = NONE,
  onPick,
  onCatalogueChange,
  buttonLabel = "+ Add label",
  disabled = false,
}: {
  catalogue: MetaLeadLabelChip[];
  excludeIds?: string[]; // labels already applied; hidden from the list
  onPick: (label: MetaLeadLabelChip) => void;
  onCatalogueChange?: (next: MetaLeadLabelChip[]) => void; // after a label is created here
  buttonLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<string>("blue");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const q = query.trim();
  const qLower = q.toLowerCase();
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);
  const matches = useMemo(
    () =>
      catalogue.filter((l) => !excluded.has(l.id) && (!qLower || l.name.toLowerCase().includes(qLower))),
    [catalogue, excluded, qLower],
  );
  // A name that is already in the catalogue (applied or not) is never offered for creation.
  const nameTaken = !!qLower && catalogue.some((l) => l.name.toLowerCase() === qLower);
  const canCreate = !!q && !nameTaken;
  const optionCount = matches.length + (canCreate ? 1 : 0);
  const activeIdx = optionCount === 0 ? -1 : Math.min(active, optionCount - 1);

  // Open on the trigger's left edge, or flip to its right edge when the 16rem popover
  // would run off the right side of the screen (a phone, with the trigger well along the
  // row). Measured here in the click handler, never during render, so SSR matches.
  function openPopover() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(256, window.innerWidth - 32); // w-64, capped like max-w-[calc(100vw-2rem)]
      setAlignRight(rect.left + width > window.innerWidth - 8 && rect.right - width >= 8);
    } else {
      setAlignRight(false);
    }
    setOpen(true);
  }

  function close(refocus = false) {
    setOpen(false);
    setQuery("");
    setActive(0);
    setError(null);
    if (refocus) triggerRef.current?.focus();
  }

  // Close on a click or focus landing outside the picker.
  useEffect(() => {
    if (!open) return;
    function outside(e: Event) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (open && activeIdx >= 0) document.getElementById(optionId(activeIdx))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIdx]);

  function pick(label: MetaLeadLabelChip) {
    close(true);
    onPick(label);
  }

  async function create() {
    if (!canCreate || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/ad-campaigns/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: q, color }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.label) {
        setError("Could not create the label");
        return;
      }
      const label: MetaLeadLabelChip = data.label;
      if (!catalogue.some((l) => l.id === label.id)) onCatalogueChange?.([...catalogue, label].sort(byName));
      pick(label);
    } catch {
      setError("Could not create the label");
    } finally {
      setCreating(false);
    }
  }

  function choose(i: number) {
    if (i < 0) return;
    if (i < matches.length) pick(matches[i]);
    else void create();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (optionCount > 0) setActive((activeIdx + 1) % optionCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (optionCount > 0) setActive((activeIdx - 1 + optionCount) % optionCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIdx);
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="relative inline-block"
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPopover())}
        className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {buttonLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Add a label"
          className={`absolute top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border border-slate-200 bg-white p-2 shadow-lg ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeIdx >= 0 ? optionId(activeIdx) : undefined}
            aria-autocomplete="list"
            aria-label="Find or create a label"
            value={query}
            maxLength={40}
            placeholder="Find or create a label…"
            className={inputCls}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setError(null);
            }}
            onKeyDown={onInputKeyDown}
          />

          <div id={listId} role="listbox" aria-label="Labels" className="max-h-56 overflow-y-auto">
            {matches.map((l, i) => (
              <button
                key={l.id}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(l)}
                className={`flex w-full items-center rounded-lg px-2 py-1 text-left ${i === activeIdx ? "bg-slate-100" : ""}`}
              >
                <span
                  className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${labelChip(l.color)}`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${labelDot(l.color)}`} />
                  <span className="truncate">{l.name}</span>
                </span>
              </button>
            ))}
            {canCreate && (
              <button
                id={optionId(matches.length)}
                type="button"
                role="option"
                aria-selected={matches.length === activeIdx}
                tabIndex={-1}
                disabled={creating}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(matches.length)}
                onClick={() => void create()}
                className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-slate-700 disabled:opacity-60 ${
                  matches.length === activeIdx ? "bg-slate-100" : ""
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${labelDot(color)}`} />
                <span className="truncate">Create &ldquo;{q}&rdquo;</span>
              </button>
            )}
            {optionCount === 0 && (
              <p className="px-2 py-2 text-xs text-slate-400">
                {nameTaken ? "Already added" : "No labels to add yet. Type a name to create one."}
              </p>
            )}
          </div>

          {canCreate && (
            <div role="group" aria-label="Label colour" className="flex items-center gap-1 px-1">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={`h-4 w-4 rounded-full ${labelDot(c)} ${
                    color === c ? "ring-2 ring-offset-1 ring-slate-400" : ""
                  }`}
                />
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="px-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
