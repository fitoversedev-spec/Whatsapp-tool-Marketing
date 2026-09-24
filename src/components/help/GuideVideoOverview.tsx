"use client";

import { useState } from "react";
import type { GuideSectionId } from "@/lib/help/types";
import { getRecordingForSection, GUIDE_SECTIONS } from "@/lib/help/registry";

export default function GuideVideoOverview({ section }: { section: GuideSectionId }) {
  const [expanded, setExpanded] = useState(false);
  const result = getRecordingForSection(section);
  const sectionMeta = GUIDE_SECTIONS.find((s) => s.id === section);

  if (!result) return null;

  return (
    <div className="card p-0 overflow-hidden mb-6">
      <div className="bg-gradient-to-r from-indigo-50 to-slate-50 p-5">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center text-lg">
            {sectionMeta?.icon ?? "\u{1F3AC}"}
          </div>
          <div>
            <h3 className="font-heading font-bold text-slate-900">{result.recording.title}</h3>
            <p className="text-sm text-slate-500">{sectionMeta?.description}</p>
          </div>
        </div>

        {result.videoUrl ? (
          <div className="mt-3">
            <video
              controls
              preload="metadata"
              className="w-full max-w-3xl rounded-lg border border-slate-200 bg-black"
              style={{ maxHeight: expanded ? "none" : "360px" }}
              onClick={() => setExpanded(true)}
            >
              <source src={result.videoUrl} type="video/webm" />
              Your browser does not support video playback.
            </video>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center">
            <div className="flex-1">
              <div className="text-2xl mb-2">{"\u{1F3AC}"}</div>
              <p className="text-sm text-slate-500 font-medium">Video overview coming soon</p>
              <p className="text-xs text-slate-400 mt-1">
                Run <code className="bg-slate-100 px-1 rounded text-xs">npm run guide:recordings</code> to generate
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
