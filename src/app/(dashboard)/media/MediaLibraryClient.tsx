"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import MediaPreview from "@/components/MediaPreview";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";
import { useToast } from "@/components/Toast";

type Media = {
  id: string;
  url: string;
  mimeType: string;
  fileName: string;
  size: number;
  category: string;
  uploadedByName: string;
  uploadedByUserId: string;
  createdAt: string;
};

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "document", label: "Documents" },
  { id: "other", label: "Other" },
];

export default function MediaLibraryClient({
  currentUserId,
  isAdmin,
  initialMedia,
  totalBytes,
}: {
  currentUserId: string;
  isAdmin: boolean;
  initialMedia: Media[];
  totalBytes: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [media, setMedia] = useState<Media[]>(initialMedia);
  const [category, setCategory] = useState<string>("all");
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => (category === "all" ? media : media.filter((m) => m.category === category)),
    [media, category]
  );
  // Only rows the user is actually allowed to delete (own upload, or admin)
  // get a checkbox at all — mirrors the single-item Delete button's own
  // condition, so "select all" never selects something bulk-delete can't do.
  const selectableIds = useMemo(
    () => filtered.filter((m) => m.uploadedByUserId === currentUserId || isAdmin).map((m) => m.id),
    [filtered, currentUserId, isAdmin]
  );

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setMedia((prev) => [
          {
            ...data.media,
            uploadedByName: "You",
            uploadedByUserId: currentUserId,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function remove(m: Media) {
    if (!confirm(`Delete "${m.fileName}"? Existing messages that reference it will still work.`)) return;
    const res = await fetch(`/api/media/${m.id}`, { method: "DELETE" });
    if (res.ok) {
      setMedia((prev) => prev.filter((x) => x.id !== m.id));
      setSelected((prev) => {
        if (!prev.has(m.id)) return prev;
        const next = new Set(prev);
        next.delete(m.id);
        return next;
      });
      router.refresh();
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    const n = selected.size;
    if (
      !confirm(
        `Delete ${n} file${n === 1 ? "" : "s"}? Existing messages that reference them will still work.`
      )
    )
      return;
    const ids = Array.from(selected);
    const res = await fetch("/api/media", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Delete failed");
      return;
    }
    const count = data.count ?? ids.length;
    setMedia((prev) => prev.filter((x) => !selected.has(x.id)));
    setSelected(new Set());
    toast.success(`Deleted ${count} file${count === 1 ? "" : "s"}`);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Media library"
        description={`${media.length} file${media.length === 1 ? "" : "s"} · ${humanSize(totalBytes)} total`}
        action={
          <label className="inline-flex items-center gap-2 bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg cursor-pointer transition text-sm">
            {uploading ? "Uploading…" : "+ Upload"}
            <input type="file" className="hidden" onChange={handleFile} disabled={uploading} />
          </label>
        }
      />

      <div className="p-4 sm:p-6 lg:p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  category === c.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {c.label}
                <span className="ml-1 text-slate-400">
                  ({c.id === "all" ? media.length : media.filter((m) => m.category === c.id).length})
                </span>
              </button>
            ))}
          </div>
          {selectableIds.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <SelectAllCheckbox ids={selectableIds} selected={selected} onChange={setSelected} />
              Select all
            </label>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
            <span className="text-red-800 font-medium">
              {selected.size} selected
            </span>
            <button onClick={bulkDelete} className="text-red-700 hover:underline font-medium">
              Delete selected
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-slate-500 hover:underline ml-auto"
            >
              Clear
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <div className="text-4xl mb-2">📎</div>
            <h3 className="font-semibold text-slate-900">
              {category === "all" ? "No media yet" : `No ${category} files`}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Upload files to reuse them across templates and conversations.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((m) => {
              const canDelete = m.uploadedByUserId === currentUserId || isAdmin;
              return (
              <div
                key={m.id}
                className={`relative bg-white border rounded-xl overflow-hidden hover:border-slate-300 transition ${
                  selected.has(m.id) ? "border-red-300 ring-2 ring-red-200" : "border-slate-200"
                }`}
              >
                {canDelete && (
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggleOne(m.id)}
                    className="absolute top-2 left-2 z-10 rounded shadow"
                    aria-label={`Select ${m.fileName}`}
                  />
                )}
                <div className="bg-slate-50 aspect-square flex items-center justify-center p-3">
                  <MediaPreview
                    url={m.url}
                    mimeType={m.mimeType}
                    fileName={m.fileName}
                    size={m.size}
                  />
                </div>
                <div className="p-3">
                  <div className="text-sm font-medium text-slate-900 truncate" title={m.fileName}>
                    {m.fileName}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                    <span>{humanSize(m.size)}</span>
                    <span>·</span>
                    <span className="capitalize">{m.category}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 truncate">
                    By {m.uploadedByName} ·{" "}
                    {new Date(m.createdAt).toLocaleDateString("en-IN")}
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => remove(m)}
                      className="mt-2 text-[10px] text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
