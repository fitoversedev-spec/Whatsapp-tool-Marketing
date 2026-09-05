"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ScoreBadge } from "@/components/scout/score";
import { atLeast, formatDayMonth, formatRadius } from "@/lib/scout/display/format";
import type { DashboardScan } from "@/lib/scout/scans/queries";

import { ArchiveScanButton } from "./ArchiveScanButton";

export function ScanListClient({ scans }: { scans: DashboardScan[] }) {
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
        `Delete ${ids.length} scan${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await Promise.all(
        ids.map((id) => fetch(`/api/scout/scans/${id}/archive`, { method: "POST" })),
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
        {scans.map((scan) => (
          <Link
            key={scan.id}
            href={`/scout/scan/${scan.id}`}
            className="group flex items-center gap-[18px] py-[15px] px-5 border-t border-slate-200 no-underline text-slate-900 font-sans first:border-t-0 hover:bg-slate-100"
          >
            {/* Checkbox */}
            <span
              className="flex-none"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle(scan.id);
              }}
            >
              <span
                className={`flex items-center justify-center w-[18px] h-[18px] rounded border-2 transition-colors cursor-pointer ${
                  selected.has(scan.id)
                    ? "bg-court-500 border-court-500"
                    : "border-slate-300 bg-white"
                }`}
              >
                {selected.has(scan.id) && (
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

            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold">{scan.areaLabel}</span>
              <span className="block text-xs text-slate-500 mt-[3px]">
                {formatRadius(scan.radiusM)} · {formatDayMonth(scan.createdAt)} ·{" "}
                {scan.ownerName}
                {scan.customerName ? ` · ${scan.customerName}` : ""}
              </span>
            </span>

            <span className="flex-none text-right min-w-[90px]">
              <span className="block font-mono text-lg font-semibold">
                {scan.facilityCount === null
                  ? "—"
                  : atLeast(scan.facilityCount, scan.saturated)}
              </span>
              <span className="block text-xs text-slate-600 mt-[3px]">Facilities</span>
            </span>

            <ScoreBadge
              total={scan.scoreTotal}
              verdict={scan.scoreVerdict}
              basis={scan.scoreBasis}
              size="sm"
            />

            <ArchiveScanButton scanId={scan.id} />
          </Link>
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
