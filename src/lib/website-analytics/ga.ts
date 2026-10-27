// The Google Analytics sections: each builds its Data API requests, reads the
// answers into plain numbers and returns the section's data (see ./types).
import {
  AI_ASSISTANT_LABELS,
  aiSourcePattern,
  classifyGaSession,
  type Classified,
} from "./sources";
import { eachDay } from "./range";
import type { GaApi, GaRunReportRequest, GaRunReportResponse } from "./google";
import type {
  AiData,
  BuildStepKey,
  LiveData,
  OverviewData,
  PagesData,
  ResolvedRange,
  SourcesData,
  Stat,
} from "./types";

// ---------------------------------------------------------------------------
// Reading a report
// ---------------------------------------------------------------------------

type Row = { dims: Record<string, string>; mets: Record<string, number> };

/** A report's rows as { dimension name: value } and { metric name: number }. */
export function rowsOf(report: GaRunReportResponse | null | undefined): Row[] {
  const dimNames = (report?.dimensionHeaders ?? []).map((h) => h.name ?? "");
  const metNames = (report?.metricHeaders ?? []).map((h) => h.name ?? "");
  return (report?.rows ?? []).map((r) => {
    const dims: Record<string, string> = {};
    const mets: Record<string, number> = {};
    dimNames.forEach((n, i) => (dims[n] = r.dimensionValues?.[i]?.value ?? ""));
    metNames.forEach((n, i) => (mets[n] = Number(r.metricValues?.[i]?.value) || 0));
    return { dims, mets };
  });
}

const gaDate = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v);
const metric = (...names: string[]) => names.map((name) => ({ name }));
const dim = (...names: string[]) => names.map((name) => ({ name }));
const NOT_SET = "(not set)";

const sumBy = <T>(items: T[], pick: (t: T) => number) => items.reduce((n, t) => n + pick(t), 0);
const avgSeconds = (engagement: number, users: number) => (users > 0 ? Math.round(engagement / users) : 0);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** What Google knows for the overview; the website leads are added from our own database. */
export type OverviewGa = Omit<OverviewData, "leads" | "series"> & { series: { date: string; visitors: number }[] };

export async function buildOverviewGa(ga: GaApi, r: ResolvedRange): Promise<OverviewGa> {
  const current = { startDate: r.from, endDate: r.to, name: "current" };
  const dateRanges = [current, { startDate: r.prevFrom, endDate: r.prevTo, name: "previous" }];
  const [totals, newReturning, daily] = await ga.batchRunReports([
    { dateRanges, metrics: metric("activeUsers", "sessions", "screenPageViews", "userEngagementDuration") },
    { dateRanges, dimensions: dim("newVsReturning"), metrics: metric("activeUsers") },
    {
      dateRanges: [current],
      dimensions: dim("date"),
      metrics: metric("activeUsers"),
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: "1000",
    },
  ]);

  const total = (period: "current" | "previous") => rowsOf(totals).find((x) => x.dims.dateRange === period)?.mets ?? {};
  const kind = (which: string): Stat => {
    const users = (period: string) =>
      sumBy(
        rowsOf(newReturning).filter((x) => x.dims.newVsReturning === which && x.dims.dateRange === period),
        (x) => x.mets.activeUsers,
      );
    return { value: users("current"), previous: users("previous") };
  };
  const stat = (name: string): Stat => ({ value: total("current")[name] ?? 0, previous: total("previous")[name] ?? 0 });

  const visitors = stat("activeUsers");
  const engagement = stat("userEngagementDuration");
  const byDate = new Map(rowsOf(daily).map((x) => [gaDate(x.dims.date), x.mets.activeUsers]));

  return {
    visitors,
    visits: stat("sessions"),
    pageViews: stat("screenPageViews"),
    avgEngagementSec: {
      value: avgSeconds(engagement.value, visitors.value),
      previous: avgSeconds(engagement.previous, visitors.previous),
    },
    newVisitors: kind("new"),
    returningVisitors: kind("returning"),
    series: eachDay(r.from, r.to).map((date) => ({ date, visitors: byDate.get(date) ?? 0 })),
  };
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

const LIVE_WINDOW_MINUTES = 30;

export async function buildLive(ga: GaApi): Promise<LiveData> {
  const minuteRanges = [{ startMinutesAgo: LIVE_WINDOW_MINUTES - 1, endMinutesAgo: 0 }];
  const byUsers = [{ metric: { metricName: "activeUsers" }, desc: true }];
  const [total, pages, devices] = await Promise.all([
    ga.runRealtimeReport({ metrics: metric("activeUsers"), minuteRanges }),
    ga.runRealtimeReport({
      dimensions: dim("unifiedScreenName"),
      metrics: metric("activeUsers"),
      orderBys: byUsers,
      limit: "10",
      minuteRanges,
    }),
    ga.runRealtimeReport({ dimensions: dim("deviceCategory"), metrics: metric("activeUsers"), orderBys: byUsers, minuteRanges }),
  ]);
  return {
    windowMinutes: LIVE_WINDOW_MINUTES,
    activeUsers: rowsOf(total)[0]?.mets.activeUsers ?? 0,
    pages: rowsOf(pages).map((x) => ({ page: x.dims.unifiedScreenName || NOT_SET, users: x.mets.activeUsers })),
    devices: rowsOf(devices).map((x) => ({ device: x.dims.deviceCategory || NOT_SET, users: x.mets.activeUsers })),
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Google's own channel for a session is a better answer than "Other website" when
 * our classifier doesn't know the site (Reddit, Brave, Startpage...).
 */
export function refineWithChannel(c: Classified, channel: string): Classified {
  if (c.group !== "Other websites") return c;
  const k = channel.toLowerCase();
  if (k === "organic search") return { label: "Other search", group: "Search" };
  if (k === "organic social" || k === "organic video") return { label: "Other social", group: "Social" };
  if (k === "email") return { label: "Email", group: "Email" };
  if (k.startsWith("paid") || k === "display" || k === "cross-network" || k === "affiliates") {
    return { label: "Other ads", group: "Paid ads" };
  }
  return c;
}

export async function buildSources(ga: GaApi, r: ResolvedRange): Promise<SourcesData> {
  const dateRanges = [{ startDate: r.from, endDate: r.to }];
  const [bySource, cities, devices] = await ga.batchRunReports([
    {
      dateRanges,
      dimensions: dim("sessionDefaultChannelGroup", "sessionSource", "sessionMedium"),
      metrics: metric("sessions"),
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "1000",
    },
    {
      dateRanges,
      dimensions: dim("city"),
      metrics: metric("activeUsers", "sessions"),
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: "12",
    },
    {
      dateRanges,
      dimensions: dim("deviceCategory"),
      metrics: metric("activeUsers", "sessions"),
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
    },
  ]);

  const pairs = new Map<string, SourcesData["topSources"][number]>();
  const groups = new Map<SourcesData["channels"][number]["group"], number>();
  let totalSessions = 0;
  for (const x of rowsOf(bySource)) {
    const c = refineWithChannel(classifyGaSession(x.dims.sessionSource, x.dims.sessionMedium), x.dims.sessionDefaultChannelGroup);
    const sessions = x.mets.sessions;
    totalSessions += sessions;
    groups.set(c.group, (groups.get(c.group) ?? 0) + sessions);
    const key = `${x.dims.sessionSource}\u0000${x.dims.sessionMedium}`;
    const hit = pairs.get(key);
    if (hit) hit.sessions += sessions;
    else pairs.set(key, { source: x.dims.sessionSource, medium: x.dims.sessionMedium, ...c, sessions });
  }

  return {
    totalSessions,
    channels: [...groups.entries()]
      .map(([group, sessions]) => ({ group, sessions, share: totalSessions > 0 ? sessions / totalSessions : 0 }))
      .sort((a, b) => b.sessions - a.sessions),
    topSources: [...pairs.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    cities: rowsOf(cities)
      .filter((x) => x.dims.city && x.dims.city !== NOT_SET)
      .slice(0, 10)
      .map((x) => ({ city: x.dims.city, visitors: x.mets.activeUsers, sessions: x.mets.sessions })),
    devices: rowsOf(devices).map((x) => ({
      device: x.dims.deviceCategory || NOT_SET,
      visitors: x.mets.activeUsers,
      sessions: x.mets.sessions,
    })),
  };
}

// ---------------------------------------------------------------------------
// AI assistants
// ---------------------------------------------------------------------------

export async function buildAi(ga: GaApi, r: ResolvedRange): Promise<AiData> {
  const dateRanges = [{ startDate: r.from, endDate: r.to }];
  // Only sessions whose source might be an AI assistant, so the reports stay small;
  // every row is classified again below.
  const dimensionFilter: GaRunReportRequest["dimensionFilter"] = {
    filter: {
      fieldName: "sessionSource",
      stringFilter: { matchType: "PARTIAL_REGEXP", value: aiSourcePattern(), caseSensitive: false },
    },
  };
  const [bySource, daily, landing] = await ga.batchRunReports([
    { dateRanges, dimensions: dim("sessionSource", "sessionMedium"), metrics: metric("sessions", "activeUsers"), dimensionFilter, limit: "1000" },
    { dateRanges, dimensions: dim("date", "sessionSource", "sessionMedium"), metrics: metric("sessions"), dimensionFilter, limit: "10000" },
    {
      dateRanges,
      dimensions: dim("landingPage", "sessionSource", "sessionMedium"),
      metrics: metric("sessions"),
      dimensionFilter,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "1000",
    },
  ]);

  const isAi = (x: Row) => classifyGaSession(x.dims.sessionSource, x.dims.sessionMedium);

  const assistants = new Map<string, { sessions: number; visitors: number }>();
  for (const x of rowsOf(bySource)) {
    const c = isAi(x);
    if (c.group !== "AI assistants") continue;
    const cur = assistants.get(c.label) ?? { sessions: 0, visitors: 0 };
    cur.sessions += x.mets.sessions;
    cur.visitors += x.mets.activeUsers;
    assistants.set(c.label, cur);
  }

  const perDay = new Map<string, number>();
  for (const x of rowsOf(daily)) {
    if (isAi(x).group !== "AI assistants") continue;
    const date = gaDate(x.dims.date);
    perDay.set(date, (perDay.get(date) ?? 0) + x.mets.sessions);
  }

  const pages = new Map<string, number>();
  for (const x of rowsOf(landing)) {
    if (isAi(x).group !== "AI assistants") continue;
    const page = x.dims.landingPage || NOT_SET;
    pages.set(page, (pages.get(page) ?? 0) + x.mets.sessions);
  }

  const list = [...assistants.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.sessions - a.sessions || AI_ASSISTANT_LABELS.indexOf(a.label) - AI_ASSISTANT_LABELS.indexOf(b.label));
  return {
    totalSessions: sumBy(list, (a) => a.sessions),
    assistants: list,
    trend: eachDay(r.from, r.to).map((date) => ({ date, sessions: perDay.get(date) ?? 0 })),
    landingPages: [...pages.entries()]
      .map(([page, sessions]) => ({ page, sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Pages and the "Build a court" steps
// ---------------------------------------------------------------------------

const BUILD_EVENTS: { key: Exclude<BuildStepKey, "viewed_build">; event: string; label: string }[] = [
  { key: "designer_step", event: "designer_step", label: "Used the court designer" },
  { key: "generate_lead", event: "generate_lead", label: "Sent a form (enquiry or design download)" },
  { key: "contact_click", event: "contact_click", label: "Clicked to contact us" },
];

export async function buildPages(ga: GaApi, r: ResolvedRange): Promise<PagesData> {
  const dateRanges = [{ startDate: r.from, endDate: r.to }];
  const [pages, viewedBuild, events] = await ga.batchRunReports([
    {
      dateRanges,
      dimensions: dim("pagePath"),
      metrics: metric("screenPageViews", "activeUsers", "userEngagementDuration"),
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: "15",
    },
    {
      dateRanges,
      metrics: metric("activeUsers"),
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/build" } } },
    },
    {
      dateRanges,
      dimensions: dim("eventName"),
      metrics: metric("activeUsers", "eventCount"),
      dimensionFilter: {
        filter: { fieldName: "eventName", inListFilter: { values: BUILD_EVENTS.map((e) => e.event) } },
      },
    },
  ]);

  const people = (event: string) => rowsOf(events).find((x) => x.dims.eventName === event)?.mets.activeUsers ?? 0;
  return {
    pages: rowsOf(pages).map((x) => ({
      path: x.dims.pagePath || NOT_SET,
      views: x.mets.screenPageViews,
      visitors: x.mets.activeUsers,
      avgEngagementSec: avgSeconds(x.mets.userEngagementDuration, x.mets.activeUsers),
    })),
    buildSteps: [
      { key: "viewed_build", label: "Looked at Build a court", people: rowsOf(viewedBuild)[0]?.mets.activeUsers ?? 0 },
      ...BUILD_EVENTS.map((e) => ({ key: e.key, label: e.label, people: people(e.event) })),
    ],
  };
}
