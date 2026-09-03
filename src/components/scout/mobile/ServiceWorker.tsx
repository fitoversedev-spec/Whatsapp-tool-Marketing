"use client";

import { useEffect } from "react";

/**
 * Register the Field-mode service worker.
 *
 * ## Scope
 *
 * `/scout/m/`, even though the file is served from `/sw.js`. A worker may always
 * narrow its scope; narrowing it here means the worker controls only the phone
 * screens, and the desktop app Phase 4 is building on the same origin is
 * untouched by any caching decision made in `public/sw.js`.
 *
 * ## Why registration is deferred to `load`
 *
 * Registering during hydration competes with the very requests that paint the
 * first screen. On the 3G profile this app is specified for, that is a visible
 * delay on the interaction that matters most. `load` costs nothing and the
 * worker is only ever needed on the *next* visit anyway.
 *
 * ## Sign-out
 *
 * The caches hold one salesperson's scans. On a shared field phone the next
 * person to sign in must not find them, so the sign-out form's submit tells the
 * worker to drop everything before the request leaves.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/scout/m/" }).catch((error) => {
        // A failed registration must never break the app — it only means no
        // offline support on this device.
        console.warn("Site Scout: service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    const onSignOut = (event: Event) => {
      const form = (event.target as HTMLElement | null)?.closest?.("form");
      if (form?.getAttribute("action") !== "/api/scout/auth/signout") return;
      navigator.serviceWorker.controller?.postMessage("CLEAR_CACHES");
    };
    document.addEventListener("submit", onSignOut, true);

    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("submit", onSignOut, true);
    };
  }, []);

  return null;
}
