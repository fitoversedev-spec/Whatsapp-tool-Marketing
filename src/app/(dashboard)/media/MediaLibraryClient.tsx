"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import MediaPreview from "@/components/MediaPreview";

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
  const [media, setMedia] = useState<Media[]>(initialMedia);
  const [category, setCategory] = useState<string>("all");
  const [uploading, setUploading] = useState(false);

  const filtered = useMemo(
    () => (category === "all" ? media : media.filter((m) => m.category === category)),
    [media, category]
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
      router.refresh();
    }
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
            {filtered.map((m) => (
              <div
                key={m.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition"
              >
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
                  {(m.uploadedByUserId === currentUserId || isAdmin) && (
                    <button
                      onClick={() => remove(m)}
                      className="mt-2 text-[10px] text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
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
