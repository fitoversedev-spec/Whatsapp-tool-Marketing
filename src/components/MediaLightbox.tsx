"use client";

// Full-screen modal preview for media attachments. Supports all file types:
//   - image → <img> centered on dark backdrop
//   - video → HTML5 <video controls>
//   - audio → HTML5 <audio controls> centered
//   - PDF → <iframe src=blob_url> (browsers render natively)
//   - office (DOCX, XLSX, PPTX) → Microsoft Office Viewer iframe
//   - other → file card with download CTA
// Click outside / Esc / close button to dismiss. Download is always available.

import { useEffect } from "react";

type Props = {
  url: string;
  mimeType: string;
  fileName: string;
  onClose: () => void;
};

const OFFICE_MIMES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

function classify(
  mimeType: string
): "image" | "video" | "audio" | "pdf" | "office" | "text" | "other" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  if (OFFICE_MIMES.includes(mimeType)) return "office";
  if (mimeType.startsWith("text/")) return "text";
  return "other";
}

export default function MediaLightbox({ url, mimeType, fileName, onClose }: Props) {
  const kind = classify(mimeType);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-stretch"
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-black/60 text-white text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="truncate flex-1 mr-3">{fileName}</div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={url}
            download={fileName}
            className="px-3 py-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 rounded-md"
          >
            ⬇ Download
          </a>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 rounded-md"
          >
            ↗ Open in tab
          </a>
          <button
            onClick={onClose}
            aria-label="Close"
            className="px-3 py-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 rounded-md"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className="flex-1 flex items-center justify-center p-4 overflow-auto"
        onClick={onClose}
      >
        <div onClick={(e) => e.stopPropagation()} className="max-w-full max-h-full">
          {kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={fileName}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          )}
          {kind === "video" && (
            <video
              src={url}
              controls
              autoPlay
              className="max-w-full max-h-[80vh] rounded-lg"
            />
          )}
          {kind === "audio" && (
            <div className="bg-white rounded-xl p-6 min-w-[320px]">
              <div className="text-sm font-medium text-slate-900 mb-3 text-center">
                {fileName}
              </div>
              <audio src={url} controls autoPlay className="w-full" />
            </div>
          )}
          {kind === "pdf" && (
            <iframe
              src={url}
              title={fileName}
              className="w-[90vw] h-[85vh] bg-white rounded-lg"
            />
          )}
          {kind === "office" && (
            <iframe
              src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
              title={fileName}
              className="w-[90vw] h-[85vh] bg-white rounded-lg"
            />
          )}
          {kind === "text" && (
            <iframe
              src={url}
              title={fileName}
              className="w-[80vw] h-[80vh] bg-white rounded-lg"
            />
          )}
          {kind === "other" && (
            <div className="bg-white rounded-xl p-8 text-center max-w-md">
              <div className="text-5xl mb-3">📎</div>
              <div className="font-semibold text-slate-900 mb-1">{fileName}</div>
              <div className="text-xs text-slate-500 mb-4">
                Preview not available for this file type ({mimeType || "unknown"}).
              </div>
              <a
                href={url}
                download={fileName}
                className="inline-block px-4 py-2 bg-wa-green text-white rounded-md text-sm font-medium hover:bg-wa-dark"
              >
                Download to view
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
