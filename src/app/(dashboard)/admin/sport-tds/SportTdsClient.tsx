"use client";

// Admin console for uploading per-sport TDS PDFs. Each sport has its
// own bucket. Files list is fed by /api/admin/sport-tds; upload posts
// FormData; delete uses a query-param DELETE. Simple UI — sales won't
// see this page (admin-only), so it's optimised for "get the PDF in
// fast" over aesthetics.

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import type { SportTdsFile } from "@/lib/court-image/sport-tds";

const SPORT_LABELS: Record<string, string> = {
  football: "Football turf",
  cricket: "Cricket",
  basketball: "Basketball",
  pickleball: "Pickleball",
  tennis: "Tennis",
  badminton: "Badminton",
  volleyball: "Volleyball",
  multisport: "Multisport",
};

export default function SportTdsClient({
  sports,
  initial,
}: {
  sports: string[];
  initial: Record<string, SportTdsFile[]>;
}) {
  const [state, setState] = useState<Record<string, SportTdsFile[]>>(initial);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const toast = useToast();

  async function upload(sport: string, name: string, file: File) {
    setBusy((b) => ({ ...b, [sport]: true }));
    try {
      const form = new FormData();
      form.set("sport", sport);
      form.set("name", name);
      form.set("file", file);
      const r = await fetch("/api/admin/sport-tds", {
        method: "POST",
        body: form,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "upload_failed");
      setState((s) => ({ ...s, [sport]: j.files }));
      toast.success("Uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy((b) => ({ ...b, [sport]: false }));
    }
  }

  async function remove(sport: string, url: string) {
    if (!confirm("Remove this TDS from the sport?")) return;
    setBusy((b) => ({ ...b, [sport]: true }));
    try {
      const qs = new URLSearchParams({ sport, url });
      const r = await fetch(`/api/admin/sport-tds?${qs}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "delete_failed");
      setState((s) => ({ ...s, [sport]: j.files }));
      toast.success("Removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy((b) => ({ ...b, [sport]: false }));
    }
  }

  return (
    <>
      <PageHeader
        title="Sport TDS uploads"
        description="Per-sport Technical Data Sheets. The Court Designer's Sport Data Panel picks these up automatically."
      />
      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        {sports.map((sport) => (
          <SportSection
            key={sport}
            sport={sport}
            label={SPORT_LABELS[sport] ?? sport}
            files={state[sport] ?? []}
            busy={!!busy[sport]}
            onUpload={upload}
            onRemove={remove}
          />
        ))}
      </div>
    </>
  );
}

function SportSection({
  sport,
  label,
  files,
  busy,
  onUpload,
  onRemove,
}: {
  sport: string;
  label: string;
  files: SportTdsFile[];
  busy: boolean;
  onUpload: (sport: string, name: string, file: File) => Promise<void>;
  onRemove: (sport: string, url: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !file) return;
    await onUpload(sport, name.trim(), file);
    setName("");
    setFile(null);
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
      <h2 className="text-base font-semibold text-slate-900 mb-3">{label}</h2>

      <form
        onSubmit={submit}
        className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 mb-4"
      >
        <input
          type="text"
          placeholder="Display name (e.g. Football turf 40mm — TDS)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
        />
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim() || !file}
          className="bg-wa-green hover:bg-wa-green/90 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          Upload
        </button>
      </form>

      {files.length === 0 ? (
        <div className="text-xs text-slate-500 italic">
          No TDS files uploaded for {label} yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.url}
              className="flex items-center gap-3 text-sm border border-slate-200 rounded-md px-3 py-2"
            >
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-wa-dark hover:underline truncate"
              >
                {f.name}
              </a>
              <span className="text-[10px] text-slate-400 font-mono">
                {new Date(f.uploadedAt).toLocaleDateString("en-IN")}
              </span>
              <button
                type="button"
                onClick={() => onRemove(sport, f.url)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
