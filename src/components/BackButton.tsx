"use client";

// Back navigation used by PageHeader across the tool. Goes to the ACTUAL
// previous page the user came from — i.e. real browser history — so drilling
// e.g. campaign detail -> lead detail and hitting Back returns to that campaign
// detail, not a hardcoded parent list. This is the app-wide "back = previous
// page" behaviour.
//
// backHref is now only a FALLBACK for when there is no in-app history to go
// back to (the page was opened directly via its URL — a fresh tab, a shared
// link, a bookmark): in that case there's nothing to go "back" to, so we send
// the user to the page's logical parent instead of stranding them. When no
// backHref is supplied either, /inbox is the safe home (matters on mobile PWA /
// fullscreen where router.back() on a fresh tab is a no-op).

import { useRouter } from "next/navigation";

export default function BackButton({
  backHref,
  label = "Back",
}: {
  backHref?: string;
  label?: string;
}) {
  const router = useRouter();

  function handleClick() {
    // Prefer real history: return to wherever the user actually came from.
    // We detect "is there an in-app entry to go back to?" via the Next.js App
    // Router history index (window.history.state.idx): 0 on this tab's first
    // app entry, +1 per in-app navigation. Using idx (not window.history.length)
    // matters because length also counts pages from OTHER origins visited in the
    // same tab — so a deep link opened from Gmail/WhatsApp Web/a search result
    // would otherwise send Back out of the app instead of to the parent.
    if (typeof window !== "undefined") {
      const state = window.history.state as { idx?: number } | null;
      const idx = typeof state?.idx === "number" ? state.idx : 0;
      if (idx > 0) {
        router.back();
        return;
      }
    }
    // No in-app history (direct URL load / external referrer) — fall back to the
    // page's logical parent so the user isn't stranded or ejected from the app.
    if (backHref) {
      router.push(backHref);
      return;
    }
    router.push("/inbox");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition -ml-1 px-1 py-1 rounded hover:bg-slate-100"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span className="font-medium">{label}</span>
    </button>
  );
}
