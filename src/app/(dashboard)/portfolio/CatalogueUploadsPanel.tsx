"use client";

// Admin-only panel for uploading/replacing the per-sport catalogue PDF
// override (src/lib/quotation/attach-catalogue.ts prefers this over the
// auto-generated fallback). Enforces the same size cap server-side
// (api/catalogues/[sport]/upload) — checked here too so the error shows up
// immediately instead of after a full upload round-trip.

import { useRef, useState } from "react";
import { useToast } from "@/components/Toast";

export type CatalogueRow = {
  sport: string;
  label: string;
  url: string | null;
};

const MAX_MB = 15;

export default function CatalogueUploadsPanel({
  isAdmin,
  initialCatalogues,
}: {
  isAdmin: boolean;
  initialCatalogues: CatalogueRow[];
}) {
  const toast = useToast();
  const [rows, setRows] = useState(initialCatalogues);
  const [busySport, setBusySport] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(sport: string, file: File) {
    if (file.type !== "application/pdf") {
      toast.error("Catalogue must be a PDF file");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(
        `File is ${(file.size / 1024 / 1024).toFixed(1)}MB — must be ${MAX_MB}MB or under. Re-export/compress it and try again.`,
      );
      return;
    }
    setBusySport(sport);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/catalogues/${sport}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Upload failed");
        return;
      }
      setRows((prev) => prev.map((r) => (r.sport === sport ? { ...r, url: data.url } : r)));
      toast.success("Catalogue uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setBusySport(null);
    }
  }

  async function remove(sport: string) {
    if (
      !confirm(
        "Remove the custom catalogue for this sport? Quotes and designs will use the auto-generated one instead.",
      )
    )
      return;
    setBusySport(sport);
    try {
      const res = await fetch(`/api/catalogues/${sport}/upload`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not remove");
        return;
      }
      setRows((prev) => prev.map((r) => (r.sport === sport ? { ...r, url: null } : r)));
      toast.success("Reverted to the auto-generated catalogue");
    } finally {
      setBusySport(null);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">Sport catalogues</div>
        <div className="text-xs text-slate-500">
          Upload a polished PDF per sport (max {MAX_MB}MB) to replace the auto-generated
          catalogue attached to quotes and combined designs. A blank sport uses the
          auto-generated version.
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {rows.map((r) => (
          <div key={r.sport} className="border border-slate-200 rounded-lg p-2.5 space-y-1.5">
            <div className="text-xs font-medium text-slate-800">{r.label}</div>
            <div className="text-[10px] text-slate-500">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-wa-green hover:underline"
                >
                  View current PDF
                </a>
              ) : (
                "Using auto-generated catalogue"
              )}
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => fileInputs.current[r.sport]?.click()}
                disabled={busySport === r.sport}
                className="flex-1 text-[10px] font-medium border border-slate-300 hover:border-slate-400 text-slate-700 rounded px-2 py-1 disabled:opacity-50"
              >
                {busySport === r.sport ? "Working…" : r.url ? "Replace" : "Upload"}
              </button>
              {r.url && (
                <button
                  type="button"
                  onClick={() => remove(r.sport)}
                  disabled={busySport === r.sport}
                  className="text-[10px] text-slate-500 hover:text-red-600 hover:bg-red-50 rounded px-2 py-1 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={(el) => {
                fileInputs.current[r.sport] = el;
              }}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(r.sport, f);
                e.target.value = "";
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
