"use client";

import { useEffect, useState } from "react";
import type { AnalyticsResponse, AnalyticsSection, ResolvedRange, SectionData } from "@/lib/website-analytics/types";
import { rangeQuery, type RangeChoice } from "./helpers";

export type ReadySection<S extends AnalyticsSection> = {
  status: "ready";
  data: SectionData[S];
  range: ResolvedRange | null;
  generatedAt: string;
};

export type SectionState<S extends AnalyticsSection> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "not-connected"; missing: string[] }
  | ReadySection<S>;

const GENERIC_ERROR = "Couldn't load this right now. Please try again.";

// Load one analytics section. Each section calls this on its own, so a slow or
// failed one never holds up the others; the error text is the server's friendly
// line. A newer range (or Try again) cancels the request still in flight so an
// old answer can't overwrite a newer one. `refreshMs` re-fetches quietly while
// the browser tab is visible (the numbers on screen stay put if a refresh fails).
// "live" ignores the date range, so its request does not change with it.
export function useAnalyticsSection<S extends AnalyticsSection>(
  section: S,
  range: RangeChoice | null,
  refreshMs?: number,
) {
  const [state, setState] = useState<SectionState<S>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const url = `/api/website-leads/analytics?section=${section}${range && section !== "live" ? rangeQuery(range) : ""}`;

  useEffect(() => {
    let ctrl: AbortController | null = null;
    let lastLoad = 0;

    async function load(quiet: boolean) {
      ctrl?.abort();
      const mine = new AbortController();
      ctrl = mine;
      lastLoad = Date.now();
      if (!quiet) setState({ status: "loading" });
      try {
        const res = await fetch(url, { signal: mine.signal });
        const body = (await res.json().catch(() => null)) as AnalyticsResponse<S> | null;
        if (mine.signal.aborted) return;
        if (!res.ok || !body || !body.ok) {
          if (quiet) return;
          const message =
            res.status === 401
              ? "Your session has expired. Please sign in again."
              : (body && !body.ok && body.error) || GENERIC_ERROR;
          setState({ status: "error", message });
          return;
        }
        if (!body.connected) {
          setState({ status: "not-connected", missing: body.missing });
          return;
        }
        setState({ status: "ready", data: body.data, range: body.range, generatedAt: body.generatedAt });
      } catch {
        if (mine.signal.aborted || quiet) return;
        setState({ status: "error", message: "Couldn't reach the server. Check your connection and try again." });
      }
    }

    load(false);
    if (!refreshMs) return () => ctrl?.abort();

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") load(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad >= refreshMs) load(true);
    };
    const timer = setInterval(refreshIfVisible, refreshMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ctrl?.abort();
    };
  }, [url, attempt, refreshMs]);

  return { state, retry: () => setAttempt((a) => a + 1) };
}
