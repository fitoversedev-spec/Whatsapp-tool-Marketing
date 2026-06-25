"use client";

// Reusable tag picker. Shows selected tags as colored pills + an inline
// "Add tag" trigger that opens a searchable dropdown. Admin users can also
// create new tags from the dropdown without leaving the page.
//
// Used in: contacts page, contact bulk-action bar, contact activity timeline,
// and (later) the conversation detail header.

import { useEffect, useRef, useState } from "react";
import { TAG_COLOR_CLASSES, type Tag } from "@/lib/tags";

type Props = {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  size?: "sm" | "md";
  canCreate?: boolean; // admin only
  placeholder?: string;
};

export default function TagPicker({
  selectedIds,
  onChange,
  size = "md",
  canCreate = false,
  placeholder = "Add tag…",
}: Props) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((data) => setAllTags(data.tags ?? []))
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function toggle(tagId: string) {
    const next = selectedIds.includes(tagId)
      ? selectedIds.filter((id) => id !== tagId)
      : [...selectedIds, tagId];
    onChange(next);
  }

  async function createInline() {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: "slate" }),
      });
      if (res.ok) {
        const data = await res.json();
        setAllTags((curr) => [...curr, data.tag].sort((a, b) => a.name.localeCompare(b.name)));
        onChange([...selectedIds, data.tag.id]);
        setQuery("");
      }
    } finally {
      setBusy(false);
    }
  }

  const filtered = query
    ? allTags.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    : allTags;
  const exactMatch = allTags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());
  const selectedTags = allTags.filter((t) => selectedIds.includes(t.id));

  const pillSize = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";
  const triggerSize = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";

  return (
    <div ref={wrapperRef} className="relative inline-flex flex-wrap items-center gap-1">
      {selectedTags.map((t) => {
        const c = TAG_COLOR_CLASSES[t.color] ?? TAG_COLOR_CLASSES.slate;
        return (
          <span
            key={t.id}
            className={`${pillSize} ${c.bg} ${c.text} rounded-full font-medium inline-flex items-center gap-1`}
          >
            {t.name}
            <button
              type="button"
              onClick={() => toggle(t.id)}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove ${t.name}`}
            >
              ×
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${triggerSize} border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 rounded-full hover:border-slate-400 hover:text-slate-700 transition`}
      >
        + {placeholder}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-80 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tags…"
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-wa-green/30"
            />
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-500">
                {query ? "No matching tags" : "No tags yet"}
              </div>
            ) : (
              filtered.map((t) => {
                const c = TAG_COLOR_CLASSES[t.color] ?? TAG_COLOR_CLASSES.slate;
                const isSelected = selectedIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-50"
                  >
                    <span className={`w-3 h-3 rounded-full ${c.dot}`} />
                    <span className="flex-1 truncate">{t.name}</span>
                    {isSelected && <span className="text-wa-green text-base leading-none">✓</span>}
                  </button>
                );
              })
            )}
            {canCreate && query.trim() && !exactMatch && (
              <button
                type="button"
                disabled={busy}
                onClick={createInline}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left bg-slate-50 hover:bg-slate-100 border-t border-slate-100 text-wa-dark font-medium"
              >
                + Create &ldquo;{query.trim()}&rdquo;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
