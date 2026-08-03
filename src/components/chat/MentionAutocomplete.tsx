"use client";

// The @-mention popup. Debounced-fetches categorized suggestions and renders
// them grouped. Anchored above the composer (full width) — no caret-pixel
// math. onMouseDown (not onClick) so picking doesn't blur the editor first.
import { useEffect, useState } from "react";

export type MentionItem = { refType: string; id: string; label: string; sublabel?: string };
type Groups = {
  people: MentionItem[]; customers: MentionItem[]; leads: MentionItem[];
  deals: MentionItem[]; quotations: MentionItem[]; courtImages: MentionItem[];
};

const GROUPS: [keyof Groups, string, string][] = [
  ["people", "People", "👤"],
  ["customers", "Customers", "🏢"],
  ["leads", "Leads", "🎯"],
  ["deals", "Deals", "📁"],
  ["quotations", "Quotes", "🧾"],
  ["courtImages", "Designs", "🎨"],
];

export default function MentionAutocomplete({
  query,
  contextCustomerId,
  personId,
  onPick,
}: {
  query: string;
  contextCustomerId: string | null;
  // When set, record suggestions narrow to this teammate's own records (DM
  // partner, or a person tagged in the team channel).
  personId: string | null;
  onPick: (item: MentionItem) => void;
}) {
  const [groups, setGroups] = useState<Groups | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ q: query });
        if (contextCustomerId) qs.set("context", contextCustomerId);
        if (personId) qs.set("person", personId);
        const res = await fetch(`/api/chat/mentions/search?${qs.toString()}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as Groups;
        if (!cancelled) setGroups(data);
      } catch {
        /* transient — ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, contextCustomerId, personId]);

  const hasAny = groups && GROUPS.some(([k]) => (groups[k]?.length ?? 0) > 0);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg z-20 text-sm">
      {loading && !groups && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
      {groups && !hasAny && <div className="px-3 py-2 text-xs text-slate-400">No matches</div>}
      {groups &&
        GROUPS.map(([key, label, icon]) => {
          const items = groups[key] ?? [];
          if (!items.length) return null;
          return (
            <div key={key}>
              <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
              {items.map((it) => (
                <button
                  key={`${it.refType}:${it.id}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(it);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2"
                >
                  <span className="shrink-0">{icon}</span>
                  <span className="font-medium text-slate-800 truncate">{it.label}</span>
                  {it.sublabel && <span className="text-xs text-slate-400 truncate">{it.sublabel}</span>}
                </button>
              ))}
            </div>
          );
        })}
    </div>
  );
}
