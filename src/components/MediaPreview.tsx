"use client";

// Renders a media attachment inline inside a chat bubble (or anywhere).
// Click → opens MediaLightbox for full-screen preview. Falls back to a
// download card for file types the browser can't render natively.

import { useState } from "react";
import MediaLightbox from "./MediaLightbox";

type Props = {
  url: string;
  mimeType: string | null;
  fileName?: string | null;
  size?: number | null;
  // When true, render at a tighter size suitable for chat bubbles.
  inline?: boolean;
};

export default function MediaPreview({ url, mimeType, fileName, size, inline = true }: Props) {
  const [open, setOpen] = useState(false);
  const cat = categorize(mimeType ?? "");

  const fileLabel = fileName ?? url.split("/").pop() ?? "file";
  const sizeLabel = size ? humanSize(size) : null;

  return (
    <>
      {cat === "image" && (
        <button
          onClick={() => setOpen(true)}
          className="block rounded-lg overflow-hidden bg-slate-100 hover:opacity-90 transition"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={fileLabel}
            loading="lazy"
            decoding="async"
            className={inline ? "max-w-[260px] max-h-[260px] object-cover" : "max-w-full max-h-[80vh]"}
          />
        </button>
      )}

      {cat === "video" && (
        <button
          onClick={() => setOpen(true)}
          className="relative block rounded-lg overflow-hidden bg-black hover:opacity-90 transition"
        >
          <video
            src={url}
            className={inline ? "max-w-[260px] max-h-[260px]" : "max-w-full max-h-[80vh]"}
            muted
            playsInline
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center text-white text-xl">
              ▶
            </div>
          </div>
        </button>
      )}

      {cat === "audio" && (
        <div className="bg-white rounded-lg p-2 border border-slate-200">
          <audio src={url} controls className="w-full max-w-[280px]" />
          {fileName && <div className="text-[10px] text-slate-500 mt-1 truncate">{fileName}</div>}
        </div>
      )}

      {cat === "document" && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-3 bg-white rounded-lg p-3 border border-slate-200 hover:border-slate-300 hover:shadow-sm transition max-w-[280px] text-left"
        >
          <div className="w-10 h-10 rounded bg-red-100 text-red-700 flex items-center justify-center text-lg shrink-0">
            {iconFor(mimeType ?? "")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900 truncate">{fileLabel}</div>
            <div className="text-[10px] text-slate-500 mt-0.5 truncate">
              {sizeLabel && <>{sizeLabel} · </>}
              {mimeType ?? "file"}
            </div>
          </div>
        </button>
      )}

      {cat === "other" && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 bg-white rounded-lg p-3 border border-slate-200 hover:border-slate-300 transition max-w-[280px]"
        >
          <div className="w-10 h-10 rounded bg-slate-100 text-slate-700 flex items-center justify-center text-lg shrink-0">
            📎
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900 truncate">{fileLabel}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {sizeLabel ?? "Open in new tab"}
            </div>
          </div>
        </a>
      )}

      {open && (
        <MediaLightbox
          url={url}
          mimeType={mimeType ?? ""}
          fileName={fileLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function categorize(mimeType: string): "image" | "video" | "audio" | "document" | "other" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf" || mimeType.startsWith("application/")) return "document";
  if (mimeType.startsWith("text/")) return "document";
  return "other";
}

function iconFor(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.includes("word")) return "📝";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "📊";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "📽️";
  if (mimeType.startsWith("text/")) return "📃";
  return "📎";
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
