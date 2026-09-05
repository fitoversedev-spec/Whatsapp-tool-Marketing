"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";

export interface EditableReportTitleProps {
  /** The report row being renamed — PATCHed to `/api/scout/reports/{id}/title`. */
  reportId: string;
  /** The current title, `""` when the row has none yet. */
  title: string;
  /** Shown in place of an empty title, and used to seed the input. */
  placeholder?: string;
  /** Called with the title the server actually stored, once a rename lands. */
  onSaved?: (title: string) => void;
  /** Classes for the display button. Override to match the call site. */
  className?: string;
  /** Classes for the input shown while editing. Override to match the call site. */
  inputClassName?: string;
}

const DEFAULT_DISPLAY_CLASS =
  "group flex items-center gap-1.5 min-w-0 max-w-full text-left bg-transparent border-0 p-0 cursor-text font-sans text-[13px] font-semibold text-slate-800 hover:text-slate-900";
const DEFAULT_INPUT_CLASS =
  "w-full box-border font-sans text-[13px] font-semibold text-slate-900 border border-slate-300 rounded-md px-2.5 py-1.5 outline-none focus:border-wa-green focus:ring-2 focus:ring-wa-green";

/**
 * Click-to-rename report title.
 *
 * The studio heading and each reports-list row both render this over the
 * same title, so a rename anywhere goes through the same PATCH and reads the
 * same way.
 *
 * Both call sites put this inside something else that is *also* clickable —
 * the reports list wraps its whole row in a `<Link>` to the studio — so
 * every click that opens or works the input calls both `preventDefault` and
 * `stopPropagation`. `stopPropagation` keeps Next's own `Link` click handler
 * from ever running; `preventDefault` cancels the browser's default
 * navigation regardless of which element the click bubbles through. Losing
 * either one turns a rename into a navigation away from the field mid-edit.
 */
export function EditableReportTitle({
  reportId,
  title,
  placeholder = "Untitled report",
  onSaved,
  className,
  inputClassName,
}: EditableReportTitleProps) {
  const baseline = title || placeholder;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(baseline);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape resets the field and unmounts the input in the same tick; the
  // input's own blur (fired by the browser as it is removed) must not also
  // run `commit`, or a cancelled edit would still save.
  const skipNextBlur = useRef(false);

  // The title can move for reasons other than this component's own save — a
  // new version regenerated, another tab renamed it. Follow it whenever the
  // field isn't mid-edit.
  useEffect(() => {
    if (!editing) setValue(baseline);
  }, [baseline, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function open(e: SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
    setValue(baseline);
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const next = value.trim();
    if (!next || next === baseline) {
      setValue(baseline);
      return;
    }
    setSaveState("saving");
    try {
      const res = await fetch(`/api/scout/reports/${reportId}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const json = (await res.json()) as { title?: string; error?: string };
      if (!res.ok || !json.title) {
        setSaveState("error");
        setValue(baseline);
        return;
      }
      setValue(json.title);
      setSaveState("saved");
      onSaved?.(json.title);
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setSaveState("error");
      setValue(baseline);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={() => {
          if (skipNextBlur.current) {
            skipNextBlur.current = false;
            return;
          }
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipNextBlur.current = true;
            setValue(baseline);
            setEditing(false);
          }
        }}
        maxLength={240}
        aria-label="Report title"
        className={inputClassName ?? DEFAULT_INPUT_CLASS}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Rename report: ${baseline}`}
      className={className ?? DEFAULT_DISPLAY_CLASS}
    >
      <span className="truncate min-w-0">{baseline}</span>
      <svg
        className="w-3.5 h-3.5 flex-none text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793 3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
      </svg>
      {saveState === "saving" ? (
        <span className="text-[10px] font-normal text-slate-400 flex-none">Saving…</span>
      ) : saveState === "saved" ? (
        <span className="text-[10px] font-normal text-turf-600 flex-none">Saved</span>
      ) : saveState === "error" ? (
        <span className="text-[10px] font-normal text-track-500 flex-none">Not saved</span>
      ) : null}
    </button>
  );
}
