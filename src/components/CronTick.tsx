"use client";

// Tiny "safety net" pinger. Runs in the background on every dashboard page
// to compensate for Vercel Hobby's ~24h cron resolution. Fires once on mount
// and then every 5 minutes while the tab is visible. Server-side endpoint is
// idempotent so dupes are harmless.

import { useEffect, useRef } from "react";

const LS_KEY = "ccd_last_tick";
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export default function CronTick() {
  const inFlight = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    async function maybeTick() {
      if (inFlight.current) return;
      if (document.visibilityState !== "visible") return;
      const last = Number(localStorage.getItem(LS_KEY) ?? "0");
      if (Date.now() - last < MIN_INTERVAL_MS) return;
      inFlight.current = true;
      try {
        await fetch("/api/cron/tick", { method: "POST" });
        localStorage.setItem(LS_KEY, String(Date.now()));
      } catch {
        // Network failure — try again next tick.
      } finally {
        inFlight.current = false;
      }
    }

    // Initial fire (debounced by LS_KEY rate limit).
    maybeTick();
    timer = setInterval(maybeTick, 60 * 1000); // check every minute
    document.addEventListener("visibilitychange", maybeTick);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", maybeTick);
    };
  }, []);

  return null;
}
