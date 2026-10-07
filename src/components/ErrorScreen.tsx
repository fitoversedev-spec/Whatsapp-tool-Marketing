"use client";

// What a route's error boundary (error.tsx) shows when a page crashes —
// instead of Next's bare "Application error" with no way back. A tab still on
// an older build after a deploy (missing code chunks) reloads itself once onto
// the new version.

import { useEffect, useState } from "react";
import Link from "next/link";
import { isChunkLoadError, reloadOnceForNewVersion } from "@/lib/chunk-reload";

export default function ErrorScreen({
  error,
  reset,
  homeHref = "/inbox",
  homeLabel = "Go to Inbox",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  const newVersion = isChunkLoadError(error);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    // Production hides error messages from the page; keep them in the console.
    console.error("[app] page error", error);
    if (newVersion && reloadOnceForNewVersion()) setReloading(true);
  }, [error, newVersion]);

  if (reloading) {
    return <div className="p-10 text-center text-sm text-slate-500">Updating to the latest version…</div>;
  }

  return (
    <div className="p-6 sm:p-10 max-w-2xl mx-auto">
      <div className="card p-8 shadow-sm">
        <div className="text-3xl mb-3">⚠️</div>
        <h1 className="text-lg font-semibold text-slate-900 mb-1">
          {newVersion ? "A new version of the app is available." : "Something went wrong on this page."}
        </h1>
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          {newVersion
            ? "Reload the page to switch to it. Anything you already saved is safe."
            : "Try again. If it keeps happening, reload the page or tell the team and share the code below."}
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary">
            Reload page
          </button>
          {!newVersion && (
            <button type="button" onClick={reset} className="btn btn-secondary">
              Try again
            </button>
          )}
          <Link href={homeHref} className="text-slate-600 hover:text-slate-900 underline text-sm px-2 py-2">
            {homeLabel}
          </Link>
        </div>
        {error?.digest && <p className="text-xs text-slate-400 font-mono">Error code: {error.digest}</p>}
      </div>
    </div>
  );
}
