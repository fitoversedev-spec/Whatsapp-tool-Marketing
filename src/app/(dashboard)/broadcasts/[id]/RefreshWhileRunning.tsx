"use client";

// A broadcast now sends in the background, slice by slice. While it's
// running, refresh this page every 15 s so the counters and the progress bar
// move on their own (only while the tab is visible). router.refresh() re-renders
// the current URL, so the recipients' page / filter / search (?status=&q=&page=)
// are kept.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RefreshWhileRunning({ running }: { running: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [running, router]);
  return null;
}
