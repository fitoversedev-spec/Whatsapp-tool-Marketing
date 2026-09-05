"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Archive (soft-delete) action for a row on the saved-scans list.
 *
 * Lives inside the row's `<Link>`, so every click handler must stop the
 * link's own navigation — otherwise "Archive" also opens the scan.
 */
export function ArchiveScanButton({ scanId }: { scanId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function archive() {
    await fetch(`/api/scout/scans/${scanId}/archive`, { method: "POST" });
    router.refresh();
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5" onClick={(e) => e.preventDefault()}>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); void archive(); }}
          className="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setConfirming(false); }}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Archive scan"
      onClick={(e) => { e.preventDefault(); setConfirming(true); }}
      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </button>
  );
}
