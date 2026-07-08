"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Item = {
  id: string;
  name: string;
  description: string;
  areaMode: "plot" | "wrap" | "per_piece" | "perimeter";
  defaultRate: number;
  gstPercent: number;
  wrapHeightFt?: number;
  optional?: boolean;
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

  function update<K extends keyof Item>(idx: number, key: K, value: Item[K]) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  function addCustomItem() {
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
      },
    ]);
  }

  function removeItem(idx: number, name: string) {
    if (!confirm(`Remove "${name}" from the rate sheet? Existing quotations are unaffected.`)) {
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function move(idx: number, direction: -1 | 1) {
    setItems((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
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
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="bg-white border border-slate-200 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Item {idx + 1} of {items.length}
                    {item.id.startsWith("custom_") && (
                      <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-semibold">
                        CUSTOM
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      disabled={idx === items.length - 1}
                      className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(idx, item.name)}
                      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                      title="Remove from rate sheet"
                    >
                      🗑 Remove
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-5">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                      Item name
                    </label>
                    <input
                      value={item.name}
                      onChange={(e) => update(idx, "name", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                      Default rate (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={item.defaultRate}
                      onChange={(e) => update(idx, "defaultRate", parseFloat(e.target.value) || 0)}
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
                      onChange={(e) => update(idx, "gstPercent", parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-wa-green/30 text-right"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                      Area mode
                    </label>
                    <select
                      value={item.areaMode}
                      onChange={(e) =>
                        update(idx, "areaMode", e.target.value as Item["areaMode"])
                      }
                      className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-wa-green/30"
                    >
                      <option value="plot">Plot area (L × W)</option>
                      <option value="perimeter">Perimeter (running ft)</option>
                      <option value="wrap">Wrap (perim × h + top)</option>
                      <option value="per_piece">Per piece</option>
                    </select>
                  </div>
                  <div className="sm:col-span-12">
                    <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                      Default description (sales can edit per-quote)
                    </label>
                    <textarea
                      value={item.description}
                      onChange={(e) => update(idx, "description", e.target.value)}
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
                        onChange={(e) => update(idx, "wrapHeightFt", parseFloat(e.target.value) || 35)}
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

            {/* + Add new line item to rate sheet */}
            <button
              type="button"
              onClick={addCustomItem}
              className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-600 hover:border-wa-green hover:text-wa-dark transition"
            >
              + Add line item to rate sheet
            </button>
          </>
        )}
      </div>
    </>
  );
}
