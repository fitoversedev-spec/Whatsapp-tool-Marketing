"use client";

// Inline pause / resume / cancel controls for a broadcast detail page.
// Shown next to the status badge — only the actions valid for the current
// status are rendered (e.g. Pause appears only when status === "running").

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BroadcastControls({
  broadcastId,
  status,
}: {
  broadcastId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string, label: string) {
    setBusy(label);
    setErr(null);
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}/${path}`, { method: path === "schedule" ? "DELETE" : "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? `${label} failed`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status === "running" && (
        <button
          onClick={() => call("pause", "pause")}
          disabled={busy !== null}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-orange-100 text-orange-800 hover:bg-orange-200 disabled:opacity-50"
        >
          {busy === "pause" ? "Pausing…" : "⏸ Pause"}
        </button>
      )}
      {status === "paused" && (
        <button
          onClick={() => call("resume", "resume")}
          disabled={busy !== null}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-50"
        >
          {busy === "resume" ? "Resuming…" : "▶ Resume"}
        </button>
      )}
      {status === "scheduled" && (
        <button
          onClick={() => call("schedule", "cancel")}
          disabled={busy !== null}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel schedule"}
        </button>
      )}
      {err && (
        <span className="text-xs text-red-600">{err}</span>
      )}
    </div>
  );
}
