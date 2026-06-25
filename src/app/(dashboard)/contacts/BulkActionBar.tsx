"use client";

// Sticky toolbar shown above the contacts table when one or more rows are
// selected. Actions: tag (replace), assign campaign on/off, delete, export
// CSV. All calls hit /api/contacts/bulk so the server can transactionally
// apply across the whole set.

import { useState } from "react";
import TagPicker from "@/components/TagPicker";
import { useToast } from "@/components/Toast";

type Tag = { id: string; name: string; color: string };

export default function BulkActionBar({
  count,
  selectedIds,
  allTags,
  onClear,
  onApplied,
}: {
  count: number;
  selectedIds: string[];
  allTags: Tag[];
  onClear: () => void;
  onApplied: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"idle" | "tag" | "consent" | "delete">("idle");
  const [pickerTagIds, setPickerTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function call(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action, payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Bulk action failed");
        return;
      }
      toast.success(`${action} applied to ${data.affected} contact${data.affected === 1 ? "" : "s"}`);
      setMode("idle");
      setPickerTagIds([]);
      onApplied();
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const params = new URLSearchParams();
    params.set("ids", selectedIds.join(","));
    window.location.href = `/api/contacts/bulk/export?${params}`;
  }

  return (
    <div className="sticky top-0 z-10 mb-3 bg-wa-green text-white rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-lg">
      <span className="font-medium text-sm">
        {count} selected
      </span>
      <button
        onClick={onClear}
        className="text-xs underline opacity-80 hover:opacity-100"
      >
        Clear
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-2 flex-wrap">
        {mode === "tag" ? (
          <div className="flex items-center gap-2 bg-white text-slate-900 rounded-md px-2 py-1.5">
            <TagPicker
              selectedIds={pickerTagIds}
              onChange={setPickerTagIds}
              canCreate
              size="sm"
              placeholder="pick tag"
            />
            <button
              onClick={() => call("set_tags", { tagIds: pickerTagIds })}
              disabled={busy}
              className="text-xs font-medium bg-wa-green text-white px-2 py-1 rounded"
            >
              Apply
            </button>
            <button onClick={() => setMode("idle")} className="text-xs text-slate-600 px-1">
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setMode("tag")}
            className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
          >
            🏷️ Tag
          </button>
        )}
        <button
          onClick={() => call("set_consent", { allowCampaign: true })}
          disabled={busy}
          className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
        >
          ✓ Allow campaigns
        </button>
        <button
          onClick={() => call("set_consent", { allowCampaign: false })}
          disabled={busy}
          className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
        >
          ✕ Block campaigns
        </button>
        <button
          onClick={exportCsv}
          className="text-xs font-medium px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-md"
        >
          ⬇ Export CSV
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete ${count} contact${count === 1 ? "" : "s"}? This cannot be undone.`)) {
              call("delete");
            }
          }}
          disabled={busy}
          className="text-xs font-medium px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-md"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}
