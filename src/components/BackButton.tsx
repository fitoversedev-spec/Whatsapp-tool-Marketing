"use client";

// Back navigation used by PageHeader across the tool. Prefers a
// caller-supplied parent route (backHref) so detail pages land on the
// right list even if the user hit the URL directly. Falls back to
// router.back() so top-level pages behave like the browser back button.
//
// If the history stack is empty AND no backHref is provided we route
// to /inbox as a safe home. This matters on mobile PWA / fullscreen
// where router.back() on a fresh tab is a no-op.

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
    if (backHref) {
      router.push(backHref);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
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
