"use client";

// Client-side error boundary for the Court Designer route. Catches the
// intermittent "Application error: a client-side exception has occurred"
// that shows up after a Vercel redeploy when a stale browser bundle
// tries to load a chunk that no longer exists — and any runtime crash
// inside the wizard / canvas — so sales sees a useful message instead
// of a blank page.

import { useEffect } from "react";
import Link from "next/link";

export default function CourtImagesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the actual error to the console so we have a chance of
    // diagnosing whatever fired. Production hides messages by default.
    console.error("[court-images] client error", error);
  }, [error]);

  const isChunkError =
    /Loading chunk|ChunkLoadError|import.*failed|dynamically imported module/i.test(
      error?.message ?? "",
    );

  return (
    <div className="p-6 sm:p-10 max-w-2xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="text-3xl mb-3">⚠️</div>
        <h1 className="text-lg font-semibold text-slate-900 mb-1">
          Something went wrong loading the Court Designer.
        </h1>
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          {isChunkError ? (
            <>
              This tab is running an older version of the app that no
              longer matches what's deployed. A hard refresh will pull
              the latest bundle and fix this.
            </>
          ) : (
            <>
              The page hit an unexpected error. Try reloading — if it
              keeps happening, share the error digest below with the
              team.
            </>
          )}
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => {
              // Full reload so a stale bundle is discarded.
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="bg-wa-green hover:bg-wa-green/90 text-white font-medium px-4 py-2 rounded-lg text-sm"
          >
            Reload page
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-slate-700 border border-slate-300 hover:border-slate-400 font-medium px-4 py-2 rounded-lg text-sm"
          >
            Try again
          </button>
          <Link
            href="/inbox"
            className="text-slate-600 hover:text-slate-900 underline text-sm px-2 py-2"
          >
            Back to inbox
          </Link>
        </div>

        {error?.digest && (
          <div className="text-[11px] text-slate-500 font-mono border-t border-slate-100 pt-3">
            Error digest: {error.digest}
          </div>
        )}
      </div>
    </div>
  );
}
