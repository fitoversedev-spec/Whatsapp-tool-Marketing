"use client";

// Inline picker for ConversationLabels. Shares the TagPicker pattern but
// targets the labels API. Kept as a separate component because the two
// concepts have different lifecycle, scope, and visual treatment
// (conversation labels typically render in the inbox row whereas tags
// render in the contacts table).

import { useEffect, useRef, useState } from "react";
import { TAG_COLOR_CLASSES } from "@/lib/tags";

type Label = { id: string; name: string; color: string };

export default function LabelPicker({
  conversationId,
  selectedIds,
  onChange,
  size = "sm",
}: {
  conversationId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  size?: "sm" | "md";
}) {
  const [all, setAll] = useState<Label[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/conversation-labels")
      .then((r) => (r.ok ? r.json() : { labels: [] }))
      .then((d) => setAll(d.labels ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function persist(nextIds: string[]) {
    onChange(nextIds);
    await fetch(`/api/conversations/${conversationId}/labels`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelIds: nextIds }),
    });
  }

  async function createInline() {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/conversation-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: "slate" }),
      });
      if (res.ok) {
        const data = await res.json();
        setAll((curr) => [...curr, data.label].sort((a, b) => a.name.localeCompare(b.name)));
        await persist([...selectedIds, data.label.id]);
        setQuery("");
      }
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    persist(next);
  }

  const selectedLabels = all.filter((l) => selectedIds.includes(l.id));
  const filtered = query
    ? all.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()))
    : all;
  const exact = all.some((l) => l.name.toLowerCase() === query.trim().toLowerCase());
  const pill = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";

  return (
    <div ref={wrapperRef} className="relative inline-flex flex-wrap items-center gap-1">
      {selectedLabels.map((l) => {
        const c = TAG_COLOR_CLASSES[l.color] ?? TAG_COLOR_CLASSES.slate;
        return (
          <span
            key={l.id}
            className={`${pill} ${c.bg} ${c.text} rounded-full font-medium inline-flex items-center gap-1`}
          >
            {l.name}
            <button
              type="button"
              onClick={() => toggle(l.id)}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove ${l.name}`}
            >
              ×
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${pill} border border-dashed border-slate-300 text-slate-500 rounded-full hover:border-slate-400 hover:text-slate-700 transition`}
      >
        + Label
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or create…"
              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-wa-green/30"
            />
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 && !query.trim() && (
              <div className="px-3 py-4 text-center text-xs text-slate-500">No labels yet</div>
            )}
            {filtered.map((l) => {
              const c = TAG_COLOR_CLASSES[l.color] ?? TAG_COLOR_CLASSES.slate;
              const sel = selectedIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggle(l.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-50"
                >
                  <span className={`w-3 h-3 rounded-full ${c.dot}`} />
                  <span className="flex-1 truncate">{l.name}</span>
                  {sel && <span className="text-wa-green text-base leading-none">✓</span>}
                </button>
              );
            })}
            {query.trim() && !exact && (
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
