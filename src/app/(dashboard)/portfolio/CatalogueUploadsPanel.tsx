"use client";

// Admin-only panel for uploading/replacing the per-sport catalogue PDF
// override (src/lib/quotation/attach-catalogue.ts prefers this over the
// auto-generated fallback, and uses it exactly as uploaded — never
// resized/recompressed). Enforces the same size cap server-side
// (api/catalogues/[sport]/upload) — checked here too so the error shows up
// immediately instead of after a full upload round-trip. The cap mirrors
// WhatsApp's own document-message limit, not a speed preference.
//
// Also manages the per-sport "project drive link" shown alongside a real
// project photo on the quotation PDF's showcase page (between "The
// Fitoverse Advantage" and "Connect With Us").

import { useRef, useState } from "react";
import { useToast } from "@/components/Toast";

export type CatalogueRow = {
  sport: string;
  label: string;
  url: string | null;
  driveLink: string | null;
};

const MAX_MB = 90;

export default function CatalogueUploadsPanel({
  isAdmin,
  initialCatalogues,
}: {
  isAdmin: boolean;
  initialCatalogues: CatalogueRow[];
}) {
  const toast = useToast();
  const [rows, setRows] = useState(initialCatalogues);
  const [driveLinkDrafts, setDriveLinkDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialCatalogues.map((r) => [r.sport, r.driveLink ?? ""])),
  );
  const [busySport, setBusySport] = useState<string | null>(null);
  const [savingLink, setSavingLink] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(sport: string, file: File) {
    if (file.type !== "application/pdf") {
      toast.error("Catalogue must be a PDF file");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(
        `File is ${(file.size / 1024 / 1024).toFixed(1)}MB — WhatsApp can't send documents over ${MAX_MB}MB. Re-export/compress it and try again.`,
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
      const curated = data.sizeBytes !== data.originalSizeBytes;
      toast.success(
        curated
          ? `Catalogue uploaded — curated to the standard page set (${(data.originalSizeBytes / 1024 / 1024).toFixed(1)}MB → ${(data.sizeBytes / 1024 / 1024).toFixed(1)}MB)`
          : "Catalogue uploaded",
      );
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

  async function saveDriveLink(sport: string) {
    setSavingLink(sport);
    try {
      const url = (driveLinkDrafts[sport] ?? "").trim();
      const res = await fetch(`/api/catalogues/${sport}/drive-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save link");
        return;
      }
      setRows((prev) => prev.map((r) => (r.sport === sport ? { ...r, driveLink: data.url } : r)));
      toast.success(url ? "Drive link saved" : "Drive link cleared");
    } catch {
      toast.error("Could not save link");
    } finally {
      setSavingLink(null);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">Sport catalogues</div>
        <div className="text-xs text-slate-500">
          Upload a polished PDF per sport (max {MAX_MB}MB — WhatsApp's document limit) to
          replace the auto-generated catalogue attached to quotes and combined designs. Used
          exactly as uploaded. A blank sport uses the auto-generated version. The drive link
          below is shown with a real project photo on the quotation's showcase page (only
          football and basketball have a photo configured for now).
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
            <div className="pt-1.5 border-t border-slate-100 space-y-1">
              <div className="text-[10px] text-slate-500">Project drive link</div>
              <div className="flex gap-1">
                <input
                  value={driveLinkDrafts[r.sport] ?? ""}
                  onChange={(e) =>
                    setDriveLinkDrafts((prev) => ({ ...prev, [r.sport]: e.target.value }))
                  }
                  placeholder="https://drive.google.com/…"
                  className="flex-1 min-w-0 text-[10px] px-1.5 py-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-wa-green/40"
                />
                <button
                  type="button"
                  onClick={() => saveDriveLink(r.sport)}
                  disabled={savingLink === r.sport}
                  className="text-[10px] font-medium border border-slate-300 hover:border-slate-400 text-slate-700 rounded px-2 py-1 disabled:opacity-50"
                >
                  {savingLink === r.sport ? "…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
