"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";

type Item = {
  id: string;
  name: string;
  description: string;
  areaMode: "plot" | "wrap" | "per_piece";
  defaultRate: number;
  gstPercent: number;
  wrapHeightFt?: number;
  optional?: boolean;
};

export default function RatesEditorClient({ initialItems }: { initialItems: Item[] }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof Item>(idx: number, key: K, value: Item[K]) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/quotations/rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      toast.success("Rate sheet saved. New quotations will use these defaults.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Quotation Rate Sheet"
        description="Default rates applied when generating Football quotations. Admin and Sales can edit."
        action={
          <button
            onClick={save}
            disabled={saving}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
          ⚠ Changes apply only to <strong>future</strong> quotations. Already-created quotes keep
          their original snapshot.
        </div>

        {items.map((item, idx) => (
          <div
            key={item.id}
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
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
                <div className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-600 capitalize">
                  {item.areaMode.replace("_", " ")}
                </div>
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
      </div>
    </>
  );
}
