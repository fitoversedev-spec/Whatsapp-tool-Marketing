"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { sectionForItem, orderedSectionsFor } from "@/lib/quotation/sections";
import {
  UNIT_OPTIONS,
  UNIT_DATALIST_ID,
  defaultUnitForAreaMode,
} from "@/lib/quotation/units";

type Item = {
  id: string;
  name: string;
  description: string;
  areaMode: "plot" | "wrap" | "per_piece" | "perimeter";
  defaultRate: number;
  gstPercent: number;
  wrapHeightFt?: number;
  optional?: boolean;
  section?: string;
  // Display unit for the quote's UNIT column (sq.ft / rft / qty / custom).
  unit?: string;
};

type Sport =
  | "football"
  | "basketball"
  | "multisport"
  | "pickleball"
  | "tennis"
  | "volleyball"
  | "cricket"
  | "badminton";

const SPORTS: { id: Sport; label: string }[] = [
  { id: "football", label: "Football Turf" },
  { id: "basketball", label: "Basketball Court" },
  { id: "multisport", label: "Multisport" },
  { id: "pickleball", label: "Pickleball" },
  { id: "tennis", label: "Tennis" },
  { id: "volleyball", label: "Volleyball" },
  { id: "cricket", label: "Cricket" },
  { id: "badminton", label: "Badminton (Indoor)" },
];

export default function RatesEditorClient({
  initialItems,
  initialSport,
}: {
  initialItems: Item[];
  initialSport: Sport;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [sport, setSport] = useState<Sport>(initialSport);
  const [items, setItems] = useState<Item[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  // Admin-added custom sections that have no items yet (so they still render).
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const allSections = orderedSectionsFor([
    ...items.map((it) => sectionForItem(it)),
    ...extraSections,
  ]);

  // Refetch when sport tab changes
  useEffect(() => {
    if (sport === initialSport) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/quotations/rates?sport=${sport}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items: Item[] }) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  function switchSport(next: Sport) {
    setSport(next);
    const search = new URLSearchParams(params.toString());
    search.set("sport", next);
    router.replace(`/settings/quotation-rates?${search}`);
  }

  function update<K extends keyof Item>(id: string, key: K, value: Item[K]) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [key]: value } : it)));
  }

  function addItemToSection(section: string) {
    const newId = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setItems((prev) => [
      ...prev,
      {
        id: newId,
        name: "New Item",
        description: "Describe what this default item covers…",
        areaMode: "plot",
        defaultRate: 0,
        gstPercent: 18,
        section,
      },
    ]);
  }

  function removeItem(id: string, name: string) {
    if (!confirm(`Remove "${name}" from the rate sheet? Existing quotations are unaffected.`)) {
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function move(id: string, direction: -1 | 1) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/quotations/rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success(
        `${sport === "football" ? "Football" : "Basketball"} rate sheet saved. New quotations will use these defaults.`
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Quotation Rate Sheets"
        description="Default rates applied when generating quotations. Admin and Sales can edit."
        action={
          <button
            onClick={save}
            disabled={saving || loading}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {/* Shared unit suggestions — powers every line item's Unit dropdown
            while still allowing a freely-typed custom unit. */}
        <datalist id={UNIT_DATALIST_ID}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        {/* Sport tabs */}
        <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => switchSport(s.id)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition ${
                sport === s.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
          ⚠ Changes apply only to <strong>future</strong> quotations. Already-created quotes keep
          their original snapshot.
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            {allSections.map((section) => {
              const secItems = items.filter((it) => sectionForItem(it) === section);
              return (
                <div key={section} className="space-y-3">
                  <div className="flex items-center gap-3 pt-3">
                    <h3 className="text-sm font-bold text-slate-800 whitespace-nowrap">{section}</h3>
                    <span className="text-xs text-slate-400">
                      {secItems.length} item{secItems.length === 1 ? "" : "s"}
                    </span>
                    <div className="flex-1 border-t border-slate-200" />
                  </div>

                  {secItems.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white border border-slate-200 rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                          {item.id.startsWith("custom_") ? (
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-semibold">
                              CUSTOM
                            </span>
                          ) : (
                            item.id
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => move(item.id, -1)}
                            className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded"
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => move(item.id, 1)}
                            className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded"
                            title="Move down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id, item.name)}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                            title="Remove from rate sheet"
                          >
                            🗑 Remove
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                        <div className="sm:col-span-4">
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                            Item name
                          </label>
                          <input
                            value={item.name}
                            onChange={(e) => update(item.id, "name", e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                            Default rate (₹)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={item.defaultRate}
                            onChange={(e) => update(item.id, "defaultRate", parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 text-right"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                            GST %
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={item.gstPercent}
                            onChange={(e) => update(item.id, "gstPercent", parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 text-right"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                            Unit
                          </label>
                          <input
                            list={UNIT_DATALIST_ID}
                            value={item.unit ?? defaultUnitForAreaMode(item.areaMode)}
                            onChange={(e) => update(item.id, "unit", e.target.value)}
                            placeholder="sq.ft"
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                            Area mode
                          </label>
                          <select
                            value={item.areaMode}
                            onChange={(e) => update(item.id, "areaMode", e.target.value as Item["areaMode"])}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                          >
                            <option value="plot">Plot area (L × W)</option>
                            <option value="perimeter">Perimeter (running ft)</option>
                            <option value="wrap">Wrap (perim × h + top)</option>
                            <option value="per_piece">Per piece</option>
                          </select>
                        </div>
                        <div className="sm:col-span-4">
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                            Section
                          </label>
                          <select
                            value={sectionForItem(item)}
                            onChange={(e) => update(item.id, "section", e.target.value)}
                            className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                          >
                            {allSections.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-12">
                          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                            Default description (sales can edit per-quote)
                          </label>
                          <textarea
                            value={item.description}
                            onChange={(e) => update(item.id, "description", e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 resize-none"
                          />
                        </div>
                        {item.areaMode === "wrap" && (
                          <div className="sm:col-span-3">
                            <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                              Wrap height (ft)
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={item.wrapHeightFt ?? 35}
                              onChange={(e) => update(item.id, "wrapHeightFt", parseFloat(e.target.value) || 35)}
                              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 text-right"
                            />
                          </div>
                        )}
                        {item.optional && (
                          <div className="sm:col-span-12 text-xs text-slate-500">
                            ☐ Optional item — unchecked by default in the wizard
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addItemToSection(section)}
                    className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-wa-green hover:text-wa-dark transition"
                  >
                    + Add item to {section}
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => {
                const name = window.prompt("New section name:")?.trim();
                if (name && !allSections.includes(name)) {
                  setExtraSections((prev) => [...prev, name]);
                }
              }}
              className="w-full py-3 border-2 border-dashed border-emerald-300 rounded-xl text-sm text-emerald-700 hover:border-wa-green hover:bg-emerald-50 transition"
            >
              + Add a new section
            </button>
          </>
        )}
      </div>
    </>
  );
}
