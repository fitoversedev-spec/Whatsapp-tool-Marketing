"use client";

import { useState } from "react";

type Props = {
  file: string;
  alt: string;
};

export default function GuideScreenshot({ file, alt }: Props) {
  const [lightbox, setLightbox] = useState(false);
  const [error, setError] = useState(false);
  const src = `/guide/${file}`;

  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
        <p className="text-sm text-slate-400">Screenshot not yet generated</p>
        <p className="text-xs text-slate-400 mt-1">
          Run <code className="bg-slate-100 px-1 rounded text-xs">npm run guide:screenshots</code>
        </p>
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={() => setLightbox(true)}
        onError={() => setError(true)}
        className="rounded-lg border border-slate-200 cursor-pointer hover:shadow-md transition-shadow max-w-full"
      />

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl"
            onClick={() => setLightbox(false)}
          >
            {"✕"}
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-[90vh] rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
