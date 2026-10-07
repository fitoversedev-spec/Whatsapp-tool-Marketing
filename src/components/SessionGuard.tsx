"use client";

// When the sign-in ends while the app is open (7 days without use, or signed
// out in another tab), every API call comes back 401 — and buttons used to just
// fail silently. This watches for that and sends the person to the login page,
// then back to the same page once they've signed in. Mounted in the signed-in
// layouts only.

import { useEffect } from "react";

let redirecting = false;

function isSessionCheck(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    return (
      url.origin === window.location.origin &&
      url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/api/auth/")
    );
  } catch {
    return false;
  }
}

export default function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;
    const guarded: typeof window.fetch = async (input, init) => {
      const res = await original(input, init);
      if (res.status === 401 && !redirecting && isSessionCheck(input)) {
        redirecting = true;
        const here = window.location.pathname + window.location.search;
        window.location.assign(`/login?next=${encodeURIComponent(here)}&reason=expired`);
      }
      return res;
    };
    window.fetch = guarded;
    return () => {
      // Only undo our own wrapper (another component may have wrapped after us).
      if (window.fetch === guarded) window.fetch = original;
    };
  }, []);
  return null;
}
