// Entry point for /api/website-leads/analytics: one section at a time, for one
// resolved date range. Google answers are cached (an hour for reports, a minute
// for "live") and a Google failure comes back as a short friendly message; the
// details go to the server log, never the key, never Google's own text.
import { unstable_cache } from "next/cache";
import { isTimeoutError, withTimeout } from "@/lib/http";
import { buildAi, buildLive, buildOverviewGa, buildPages, buildSources } from "./ga";
import {
  AnalyticsConfigError,
  describeGoogleError,
  getGaApi,
  getGscApi,
  googleStatus,
  missingSettings,
} from "./google";
import { leadCounts, leadsBySource, overviewLeads } from "./leads";
import { buildSearch } from "./search";
import {
  ANALYTICS_SECTIONS,
  type AnalyticsResponse,
  type AnalyticsSection,
  type OverviewData,
  type ResolvedRange,
} from "./types";

export * from "./types";
export { resolveRange } from "./range";

const REPORT_SECONDS = 60 * 60;
const LIVE_SECONDS = 60;
// Longer than Google's own 20 s call limit, shorter than the route's 30 s.
const SECTION_TIMEOUT_MS = 22_000;

export function parseSection(raw: string | null | undefined): AnalyticsSection | null {
  return (ANALYTICS_SECTIONS as readonly string[]).includes(raw ?? "") ? (raw as AnalyticsSection) : null;
}

/** Cache a Google answer; an error is thrown through and never cached. */
function cached<T>(name: string, parts: string[], seconds: number, build: () => Promise<T>) {
  return unstable_cache(
    async () => ({ generatedAt: new Date().toISOString(), data: await withTimeout(build(), SECTION_TIMEOUT_MS, "Google") }),
    ["website-analytics", name, ...parts],
    { revalidate: seconds, tags: ["website-analytics"] },
  )();
}

function friendlyError(err: unknown): string {
  if (err instanceof AnalyticsConfigError) {
    return "Analytics is connected, but its Google settings look wrong. Ask an admin to check them.";
  }
  if (isTimeoutError(err)) return "Google took too long to answer. Please try again in a moment.";
  const status = googleStatus(err);
  if (status === 401 || status === 403) {
    return "Google didn't allow access. Ask an admin to check that the analytics account has been given access.";
  }
  if (status === 404) return "Google couldn't find the analytics property or site. Ask an admin to check the settings.";
  if (status === 429) return "Google is limiting requests right now. Please try again in a few minutes.";
  return "Couldn't load analytics right now. Please try again.";
}

export async function getAnalytics(
  section: AnalyticsSection,
  range: ResolvedRange | null,
  now: Date = new Date(),
): Promise<AnalyticsResponse> {
  try {
    // Our own database: always available, always fresh.
    if (section === "leadsBySource") {
      if (!range) throw new Error("range required");
      return { ok: true, connected: true, section, range, generatedAt: now.toISOString(), data: await leadsBySource(range) };
    }

    const missing = missingSettings(section === "search" ? "gsc" : "ga");
    if (missing.length > 0) return { ok: true, connected: false, section, missing };

    if (section === "live") {
      const { generatedAt, data } = await cached("live", [], LIVE_SECONDS, async () => buildLive(await getGaApi()));
      return { ok: true, connected: true, section, range: null, generatedAt, data };
    }

    if (!range) throw new Error("range required");
    const parts = [range.from, range.to];

    switch (section) {
      case "overview": {
        // The leads are counted fresh: only the Google half is cached.
        const [google, counts] = await Promise.all([
          cached("overview", parts, REPORT_SECONDS, async () => buildOverviewGa(await getGaApi(), range)),
          leadCounts(range),
        ]);
        const data: OverviewData = {
          ...google.data,
          series: google.data.series.map((d) => ({ ...d, leads: counts.perDay.get(d.date) ?? 0 })),
          leads: overviewLeads(counts, google.data.visitors),
        };
        return { ok: true, connected: true, section, range, generatedAt: google.generatedAt, data };
      }
      case "sources":
      case "ai":
      case "pages": {
        const build = { sources: buildSources, ai: buildAi, pages: buildPages }[section];
        const { generatedAt, data } = await cached(section, parts, REPORT_SECONDS, async () => build(await getGaApi(), range));
        return { ok: true, connected: true, section, range, generatedAt, data } as AnalyticsResponse;
      }
      case "search": {
        const { generatedAt, data } = await cached("search", parts, REPORT_SECONDS, async () =>
          buildSearch(await getGscApi(), range, now),
        );
        return { ok: true, connected: true, section, range, generatedAt, data };
      }
    }
  } catch (err) {
    console.error(`[website-analytics] ${section} failed: ${describeGoogleError(err)}`);
    return { ok: false, error: friendlyError(err) };
  }
}
