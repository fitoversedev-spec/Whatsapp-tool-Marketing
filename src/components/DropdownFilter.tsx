"use client";

// Searchable single-select filter with per-option counts — the City / Stage /
// Assigned-to filters on the Meta ad leads table and the CRM Leads list.
import { useEffect, useRef, useState } from "react";

export type DropdownOption = { label: string; count: number };

export function DropdownFilter({ label, value, onChange, options, guide }: { label: string; value: string; onChange: (v: string) => void; options: DropdownOption[]; guide?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())) : options;

  return (
    <div ref={ref} className="relative" data-guide={guide}>
      <label className="block text-[11px] font-medium text-slate-600 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(""); }}
        className="flex items-center justify-between gap-1 w-44 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-left hover:border-slate-400 transition-colors"
      >
        <span className={value ? "text-slate-900 truncate" : "text-slate-400 truncate"}>{value || "Choose…"}</span>
        <svg className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg">
          {options.length > 5 && (
            <div className="p-1.5 border-b border-slate-100">
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400" />
            </div>
          )}
          <div className="max-h-52 overflow-y-auto py-1">
            {value && (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="w-full px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50">Clear selection</button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
            ) : (
              filtered.map((o) => (
                <button key={o.label} type="button" onClick={() => { onChange(o.label); setOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors ${o.label === value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700"}`}>
                  <span className="truncate text-left">{o.label}</span>
                  <span className="shrink-0 text-xs font-mono text-slate-400">{o.count}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
