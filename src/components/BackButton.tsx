"use client";

// Back navigation used by PageHeader across the tool. Goes to the ACTUAL
// previous page the user came from — i.e. real browser history — so drilling
// e.g. campaign detail -> lead detail and hitting Back returns to that campaign
// detail, not a hardcoded parent list. This is the app-wide "back = previous
// page" behaviour.
//
// backHref is now only a FALLBACK for when there is no in-app history to go
// back to (the page was opened directly via its URL — a fresh tab, a shared
// link, a bookmark, an external referrer): in that case there's nothing to go
// "back" to, so we send the user to the page's logical parent instead of
// stranding them. When no backHref is supplied either, /inbox is the safe home.
//
// "Is there in-app history?" is answered by our own nav counter (nav-history),
// NOT window.history — see that file for why (external same-tab pages inflate
// history.length, and Next 14's App Router has no history index).

import { useRouter } from "next/navigation";
import { hasInAppHistory } from "@/lib/nav-history";

export default function BackButton({
  backHref,
  label = "Back",
}: {
  backHref?: string;
  label?: string;
}) {
  const router = useRouter();

  function handleClick() {
    // Prefer real history: return to the actual previous in-app page the user
    // came from (e.g. campaign detail -> lead -> Back = campaign detail).
    if (hasInAppHistory()) {
      router.back();
      return;
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
