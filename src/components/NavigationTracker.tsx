"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { markInAppNav } from "@/lib/nav-history";

// Mounted once in the dashboard layout. Bumps the in-app navigation counter
// (see nav-history) on every real client-side pathname change, skipping the
// initial page render. Comparing against the last-seen pathname (rather than a
// "first render" boolean) makes it safe under React StrictMode's double-invoked
// effects in dev — a re-run with an unchanged pathname never counts as a nav.
// Renders nothing.
export default function NavigationTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === null) {
      lastPath.current = pathname; // initial page — not a navigation
      return;
    }
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      markInAppNav();
    }
  }, [pathname]);

  return null;
}
