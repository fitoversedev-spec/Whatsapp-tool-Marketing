"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { recordInAppPath } from "@/lib/nav-history";

// Mounted in the app layouts. Reports every pathname to the in-app history
// stack (see nav-history) — the first page of a full load, client-side
// navigations, and Back/Forward (which pop it). A repeated path is ignored, so
// React StrictMode's double-invoked effects in dev and remounting when moving
// between apps (marketing ↔ CRM) never count twice. Renders nothing.
export default function NavigationTracker() {
  const pathname = usePathname();

  useEffect(() => {
    recordInAppPath(pathname);
  }, [pathname]);

  return null;
}
