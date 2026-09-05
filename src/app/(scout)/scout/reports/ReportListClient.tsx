"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ReportListEntry } from "@/components/scout/reports";
import type { ReportListRow } from "@/lib/scout/reports/repository";

export function ReportListClient({ reports }: { reports: ReportListRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (
      !window.confirm(
        `Delete ${ids.length} report${ids.length === 1 ? "" : "s"}? Any links already sent keep working.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await Promise.all(
        ids.map((id) => fetch(`/api/scout/reports/${id}/archive`, { method: "POST" })),
      );
      setSelected(new Set());
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="relative">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {reports.map((r) => (
          <div
            key={r.id}
            className="flex items-center border-t border-slate-200 first:border-t-0"
          >
            {/* Checkbox */}
            <span
              className="flex-none pl-4 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle(r.id);
              }}
            >
              <span
                className={`flex items-center justify-center w-[18px] h-[18px] rounded border-2 transition-colors ${
                  selected.has(r.id)
                    ? "bg-court-500 border-court-500"
                    : "border-slate-300 bg-white"
                }`}
              >
                {selected.has(r.id) && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </span>

            {/* Report entry — its own border-t is neutralised by :first-child
                since it is the sole child of this wrapper div */}
            <div className="flex-1 min-w-0">
              <ReportListEntry report={r} />
            </div>
          </div>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 mt-4 mx-auto w-fit bg-white shadow-lg rounded-xl flex items-center gap-3 px-5 py-3 border border-slate-200">
          <span className="text-sm font-medium text-slate-700">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={bulkDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete selected"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
