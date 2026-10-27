import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// googleapis is mocked at the two API files the app imports; nothing reaches Google.
const g = vi.hoisted(() => ({
  batchRunReports: vi.fn(),
  runReport: vi.fn(),
  runRealtimeReport: vi.fn(),
  gscQuery: vi.fn(),
  jwtOptions: [] as Record<string, unknown>[],
  analyticsOptions: [] as unknown[],
}));
vi.mock("googleapis/build/src/apis/analyticsdata", () => {
  class JWT {
    constructor(opts: Record<string, unknown>) {
      g.jwtOptions.push(opts);
    }
  }
  class AuthPlus {
    JWT = JWT;
  }
  class Analyticsdata {
    properties = { batchRunReports: g.batchRunReports, runReport: g.runReport, runRealtimeReport: g.runRealtimeReport };
    constructor(opts: unknown) {
      g.analyticsOptions.push(opts);
    }
  }
  return { AuthPlus, analyticsdata_v1beta: { Analyticsdata } };
});
vi.mock("googleapis/build/src/apis/searchconsole", () => {
  class JWT {
    constructor(opts: Record<string, unknown>) {
      g.jwtOptions.push(opts);
    }
  }
  class AuthPlus {
    JWT = JWT;
  }
  class Searchconsole {
    searchanalytics = { query: g.gscQuery };
  }
  return { AuthPlus, searchconsole_v1: { Searchconsole } };
});

const db = vi.hoisted(() => ({
  websiteLead: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

// Next's data cache needs a running server: run the work straight away and remember how it was cached.
const cache = vi.hoisted(() => ({ calls: [] as { parts: string[]; options: Record<string, unknown> }[] }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown, parts: string[], options: Record<string, unknown>) => {
    cache.calls.push({ parts, options });
    return () => fn();
  },
}));

import { getAnalytics, resolveRange, type ResolvedRange } from "..";
import { refineWithChannel } from "../ga";

// 2026-10-27 10:00 IST
const NOW = new Date("2026-10-27T04:30:00Z");
const range = (r: string, from?: string, to?: string): ResolvedRange => {
  const out = resolveRange({ range: r, from, to }, NOW);
  if (!out.ok) throw new Error(out.error);
  return out.range;
};

const KEY = "-----BEGIN PRIVATE KEY-----\nMIItop-secret-key\n-----END PRIVATE KEY-----\n";
const CREDENTIALS = Buffer.from(JSON.stringify({ client_email: "svc@proj.iam.gserviceaccount.com", private_key: KEY })).toString("base64");

function connect(over: Record<string, string> = {}) {
  vi.stubEnv("GA4_PROPERTY_ID", "123456789");
  vi.stubEnv("GSC_SITE_URL", "sc-domain:fitoverse.com");
  vi.stubEnv("GOOGLE_ANALYTICS_CREDENTIALS", CREDENTIALS);
  for (const [k, v] of Object.entries(over)) vi.stubEnv(k, v);
}

type Header = { name: string };
/** A Data API report: dimension names, metric names and rows of [dimension values..., metric values...]. */
function report(dims: string[], mets: string[], rows: (string | number)[][]) {
  return {
    dimensionHeaders: dims.map((name): Header => ({ name })),
    metricHeaders: mets.map((name): Header => ({ name })),
    rows: rows.map((r) => ({
      dimensionValues: r.slice(0, dims.length).map((value) => ({ value: String(value) })),
      metricValues: r.slice(dims.length).map((value) => ({ value: String(value) })),
    })),
  };
}
const batch = (...reports: unknown[]) => g.batchRunReports.mockResolvedValueOnce({ data: { reports } });

beforeEach(() => {
  vi.clearAllMocks();
  g.jwtOptions.length = 0;
  g.analyticsOptions.length = 0;
  cache.calls.length = 0;
  db.websiteLead.findMany.mockResolvedValue([]);
  db.websiteLead.count.mockResolvedValue(0);
  db.websiteLead.groupBy.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("not connected", () => {
  it("every Google Analytics section says connected: false and never calls Google", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "");
    vi.stubEnv("GOOGLE_ANALYTICS_CREDENTIALS", "");
    for (const section of ["overview", "live", "sources", "ai", "pages"] as const) {
      expect(await getAnalytics(section, range("30d"), NOW)).toEqual({
        ok: true,
        connected: false,
        section,
        missing: ["GA4_PROPERTY_ID", "GOOGLE_ANALYTICS_CREDENTIALS"],
      });
    }
    expect(g.batchRunReports).not.toHaveBeenCalled();
    expect(g.runRealtimeReport).not.toHaveBeenCalled();
  });

  it("names only the settings that are missing", async () => {
    connect({ GA4_PROPERTY_ID: "" });
    expect(await getAnalytics("overview", range("30d"), NOW)).toMatchObject({ connected: false, missing: ["GA4_PROPERTY_ID"] });
  });

  it("a missing GSC_SITE_URL disconnects only the search section", async () => {
    connect({ GSC_SITE_URL: "" });
    expect(await getAnalytics("search", range("30d"), NOW)).toEqual({
      ok: true,
      connected: false,
      section: "search",
      missing: ["GSC_SITE_URL"],
    });
    g.runRealtimeReport.mockResolvedValue({ data: report([], ["activeUsers"], [[3]]) });
    expect(await getAnalytics("live", null, NOW)).toMatchObject({ ok: true, connected: true, section: "live" });
  });

  it("leads by source comes from our database and needs no Google settings", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "");
    vi.stubEnv("GOOGLE_ANALYTICS_CREDENTIALS", "");
    expect(await getAnalytics("leadsBySource", range("30d"), NOW)).toMatchObject({ ok: true, connected: true, data: { total: 0 } });
  });
});

describe("overview", () => {
  const r7 = () => range("7d"); // 2026-10-21 .. 2026-10-27, previous 10-14 .. 10-20

  function overviewReports() {
    batch(
      report(["dateRange"], ["activeUsers", "sessions", "screenPageViews", "userEngagementDuration"], [
        ["current", 120, 150, 400, 6000],
        ["previous", 100, 130, 300, 4000],
      ]),
      report(["newVsReturning", "dateRange"], ["activeUsers"], [
        ["new", "current", 80],
        ["returning", "current", 40],
        ["new", "previous", 70],
        ["returning", "previous", 30],
      ]),
      report(["date"], ["activeUsers"], [["20261025", 10], ["20261027", 5]]),
    );
  }

  it("maps visitors, visits, page views, engagement and new vs returning, each with the previous period", async () => {
    connect();
    overviewReports();
    db.websiteLead.findMany.mockResolvedValue([
      { receivedAt: new Date("2026-10-25T20:00:00Z") }, // 01:30 IST on the 26th
      { receivedAt: new Date("2026-10-26T05:00:00Z") },
      { receivedAt: new Date("2026-10-27T01:00:00Z") },
    ]);
    db.websiteLead.count.mockResolvedValue(2);

    const res = await getAnalytics("overview", r7(), NOW);
    expect(res).toMatchObject({ ok: true, connected: true, section: "overview", range: r7() });
    if (!res.ok || !res.connected) throw new Error("expected data");
    const d = res.data as import("../types").OverviewData;

    expect(d.visitors).toEqual({ value: 120, previous: 100 });
    expect(d.visits).toEqual({ value: 150, previous: 130 });
    expect(d.pageViews).toEqual({ value: 400, previous: 300 });
    expect(d.avgEngagementSec).toEqual({ value: 50, previous: 40 }); // 6000 s / 120, 4000 s / 100
    expect(d.newVisitors).toEqual({ value: 80, previous: 70 });
    expect(d.returningVisitors).toEqual({ value: 40, previous: 30 });

    expect(d.series).toHaveLength(7);
    expect(d.series[0]).toEqual({ date: "2026-10-21", visitors: 0, leads: 0 });
    expect(d.series.find((x) => x.date === "2026-10-25")).toEqual({ date: "2026-10-25", visitors: 10, leads: 0 });
    // Leads are bucketed by IST day, not UTC day.
    expect(d.series.find((x) => x.date === "2026-10-26")).toEqual({ date: "2026-10-26", visitors: 0, leads: 2 });
    expect(d.series.find((x) => x.date === "2026-10-27")).toEqual({ date: "2026-10-27", visitors: 5, leads: 1 });
    expect(d.leads).toEqual({ total: 3, previous: 2, rate: 0.025, previousRate: 0.02 });
  });

  it("asks Google for both periods, in IST dates, named current and previous", async () => {
    connect();
    overviewReports();
    await getAnalytics("overview", r7(), NOW);

    const [args] = g.batchRunReports.mock.calls[0];
    expect(args.property).toBe("properties/123456789");
    const [totals, newReturning, daily] = args.requestBody.requests;
    const both = [
      { startDate: "2026-10-21", endDate: "2026-10-27", name: "current" },
      { startDate: "2026-10-14", endDate: "2026-10-20", name: "previous" },
    ];
    expect(totals.dateRanges).toEqual(both);
    expect(totals.metrics.map((m: { name: string }) => m.name)).toEqual([
      "activeUsers", "sessions", "screenPageViews", "userEngagementDuration",
    ]);
    expect(newReturning.dateRanges).toEqual(both);
    expect(newReturning.dimensions).toEqual([{ name: "newVsReturning" }]);
    expect(daily.dateRanges).toEqual([both[0]]);
    expect(daily.dimensions).toEqual([{ name: "date" }]);
  });

  it("counts only live leads of the range (deleted ones hidden, IST day bounds)", async () => {
    connect();
    overviewReports();
    await getAnalytics("overview", r7(), NOW);

    const where = db.websiteLead.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ deletedAt: null });
    expect(where.AND).toContainEqual({
      receivedAt: { gte: new Date("2026-10-20T18:30:00.000Z"), lte: new Date("2026-10-27T18:29:59.999Z") },
    });
    const prev = db.websiteLead.count.mock.calls[0][0].where;
    expect(prev.AND).toContainEqual({
      receivedAt: { gte: new Date("2026-10-13T18:30:00.000Z"), lte: new Date("2026-10-20T18:29:59.999Z") },
    });
  });

  it("zeroes everything when Google has no rows, and the lead rate is null with no visitors", async () => {
    connect();
    batch(report(["dateRange"], ["activeUsers"], []), report(["newVsReturning", "dateRange"], ["activeUsers"], []), {});
    db.websiteLead.findMany.mockResolvedValue([{ receivedAt: new Date("2026-10-26T05:00:00Z") }]);
    const res = await getAnalytics("overview", r7(), NOW);
    if (!res.ok || !res.connected) throw new Error("expected data");
    const d = res.data as import("../types").OverviewData;
    expect(d.visitors).toEqual({ value: 0, previous: 0 });
    expect(d.avgEngagementSec).toEqual({ value: 0, previous: 0 });
    expect(d.leads).toEqual({ total: 1, previous: 0, rate: null, previousRate: null });
    expect(d.series.every((x) => x.visitors === 0)).toBe(true);
  });

  it("caches only the Google half for an hour, keyed by section and resolved dates", async () => {
    connect();
    overviewReports();
    await getAnalytics("overview", r7(), NOW);
    expect(cache.calls).toHaveLength(1);
    expect(cache.calls[0].parts).toEqual(["website-analytics", "overview", "2026-10-21", "2026-10-27"]);
    expect(cache.calls[0].options.revalidate).toBe(3600);
  });

  it("signs in with a JWT for both read-only scopes", async () => {
    connect({ GA4_PROPERTY_ID: "424242" }); // a property no earlier test used, so the signed-in client is built fresh
    overviewReports();
    await getAnalytics("overview", r7(), NOW);
    expect(g.jwtOptions[0]).toEqual({
      email: "svc@proj.iam.gserviceaccount.com",
      key: KEY,
      scopes: [
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/webmasters.readonly",
      ],
    });
  });
});

describe("live", () => {
  it("maps active users, top pages and the device split, cached for a minute", async () => {
    connect();
    g.runRealtimeReport.mockImplementation(async ({ requestBody }: { requestBody: { dimensions?: { name: string }[] } }) => {
      const dim = requestBody.dimensions?.[0]?.name;
      if (dim === "unifiedScreenName") {
        return { data: report(["unifiedScreenName"], ["activeUsers"], [["Build a court", 4], ["Home", 2]]) };
      }
      if (dim === "deviceCategory") return { data: report(["deviceCategory"], ["activeUsers"], [["mobile", 5], ["desktop", 1]]) };
      return { data: report([], ["activeUsers"], [[6]]) };
    });

    const res = await getAnalytics("live", null, NOW);
    expect(res).toMatchObject({
      ok: true,
      connected: true,
      section: "live",
      range: null,
      data: {
        windowMinutes: 30,
        activeUsers: 6,
        pages: [{ page: "Build a court", users: 4 }, { page: "Home", users: 2 }],
        devices: [{ device: "mobile", users: 5 }, { device: "desktop", users: 1 }],
      },
    });
    expect(cache.calls[0].parts).toEqual(["website-analytics", "live"]);
    expect(cache.calls[0].options.revalidate).toBe(60);

    const pageRequest = g.runRealtimeReport.mock.calls.map((c) => c[0].requestBody).find((b) => b.dimensions?.[0]?.name === "unifiedScreenName");
    expect(pageRequest.limit).toBe("10");
    expect(pageRequest.minuteRanges).toEqual([{ startMinutesAgo: 29, endMinutesAgo: 0 }]);
  });

  it("shows no one online when Google has no rows", async () => {
    connect();
    g.runRealtimeReport.mockResolvedValue({ data: {} });
    const res = await getAnalytics("live", null, NOW);
    expect(res).toMatchObject({ data: { activeUsers: 0, pages: [], devices: [] } });
  });
});

describe("sources", () => {
  const SESSIONS = report(["sessionDefaultChannelGroup", "sessionSource", "sessionMedium"], ["sessions"], [
    ["Direct", "(direct)", "(none)", 50],
    ["Organic Search", "google", "organic", 40],
    ["Referral", "chatgpt.com", "referral", 12],
    ["Referral", "perplexity.ai", "referral", 3],
    ["Paid Search", "google", "cpc", 10],
    ["Organic Social", "l.instagram.com", "referral", 5],
    ["Organic Social", "reddit.com", "referral", 4],
    ["Referral", "blog.example.com", "referral", 6],
  ]);

  it("regroups sessions through the shared classifier so AI assistants get their own group", async () => {
    connect();
    batch(
      SESSIONS,
      report(["city"], ["activeUsers", "sessions"], [["Pune", 30, 35], ["(not set)", 20, 22], ["Mumbai", 10, 12]]),
      report(["deviceCategory"], ["activeUsers", "sessions"], [["mobile", 70, 90], ["desktop", 30, 40]]),
    );
    const res = await getAnalytics("sources", range("30d"), NOW);
    if (!res.ok || !res.connected) throw new Error("expected data");
    const d = res.data as import("../types").SourcesData;

    expect(d.totalSessions).toBe(130);
    expect(d.channels.map((c) => [c.group, c.sessions])).toEqual([
      ["Direct", 50],
      ["Search", 40],
      ["AI assistants", 15],
      ["Paid ads", 10],
      ["Social", 9], // Instagram (5) + Reddit (4), which Google's own channel says is social
      ["Other websites", 6],
    ]);
    expect(d.channels[0].share).toBeCloseTo(50 / 130);
    expect(d.channels.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1);

    expect(d.topSources).toHaveLength(8);
    expect(d.topSources[0]).toEqual({ source: "(direct)", medium: "(none)", label: "Direct", group: "Direct", sessions: 50 });
    expect(d.topSources).toContainEqual({ source: "chatgpt.com", medium: "referral", label: "ChatGPT", group: "AI assistants", sessions: 12 });
    expect(d.topSources).toContainEqual({ source: "google", medium: "cpc", label: "Google Ads", group: "Paid ads", sessions: 10 });
    expect(d.topSources).toContainEqual({ source: "reddit.com", medium: "referral", label: "Other social", group: "Social", sessions: 4 });

    expect(d.cities).toEqual([
      { city: "Pune", visitors: 30, sessions: 35 },
      { city: "Mumbai", visitors: 10, sessions: 12 },
    ]);
    expect(d.devices).toEqual([
      { device: "mobile", visitors: 70, sessions: 90 },
      { device: "desktop", visitors: 30, sessions: 40 },
    ]);
  });

  it("keeps only the top 10 source / medium pairs and top 10 cities", async () => {
    connect();
    const many = Array.from({ length: 14 }, (_, i) => ["Referral", `site${i}.com`, "referral", 100 - i]);
    const cities = Array.from({ length: 12 }, (_, i) => [`City ${i}`, 50 - i, 60 - i]);
    batch(report(["sessionDefaultChannelGroup", "sessionSource", "sessionMedium"], ["sessions"], many), report(["city"], ["activeUsers", "sessions"], cities), {});
    const res = await getAnalytics("sources", range("30d"), NOW);
    if (!res.ok || !res.connected) throw new Error("expected data");
    const d = res.data as import("../types").SourcesData;
    expect(d.topSources).toHaveLength(10);
    expect(d.topSources[0].source).toBe("site0.com");
    expect(d.cities).toHaveLength(10);
    expect(d.channels).toHaveLength(1);
  });

  it("refineWithChannel only touches sites the classifier doesn't know", () => {
    const other = { label: "Other website", group: "Other websites" } as const;
    expect(refineWithChannel(other, "Organic Search")).toEqual({ label: "Other search", group: "Search" });
    expect(refineWithChannel(other, "Paid Social").group).toBe("Paid ads");
    expect(refineWithChannel(other, "Email").group).toBe("Email");
    expect(refineWithChannel(other, "Referral")).toEqual(other);
    const chatgpt = { label: "ChatGPT", group: "AI assistants" } as const;
    expect(refineWithChannel(chatgpt, "Organic Search")).toEqual(chatgpt);
  });
});

describe("ai", () => {
  it("groups AI sessions per assistant, builds the daily trend and the landing pages", async () => {
    connect();
    batch(
      report(["sessionSource", "sessionMedium"], ["sessions", "activeUsers"], [
        ["chatgpt.com", "referral", 12, 10],
        ["chat.openai.com", "referral", 5, 4],
        ["perplexity.ai", "referral", 3, 3],
        ["poe.com", "referral", 1, 1],
        ["poet.example.com", "referral", 9, 9], // matches the loose Google filter, but isn't an AI assistant
      ]),
      report(["date", "sessionSource", "sessionMedium"], ["sessions"], [
        ["20261026", "chatgpt.com", "referral", 4],
        ["20261026", "perplexity.ai", "referral", 1],
        ["20261027", "chat.openai.com", "referral", 2],
        ["20261027", "poet.example.com", "referral", 9],
      ]),
      report(["landingPage", "sessionSource", "sessionMedium"], ["sessions"], [
        ["/build", "chatgpt.com", "referral", 8],
        ["/build", "perplexity.ai", "referral", 2],
        ["/", "chatgpt.com", "referral", 4],
        ["/blog/turf", "poet.example.com", "referral", 9],
      ]),
    );
    const res = await getAnalytics("ai", range("7d"), NOW);
    if (!res.ok || !res.connected) throw new Error("expected data");
    const d = res.data as import("../types").AiData;

    expect(d.assistants).toEqual([
      { label: "ChatGPT", sessions: 17, visitors: 14 },
      { label: "Perplexity", sessions: 3, visitors: 3 },
      { label: "Other AI", sessions: 1, visitors: 1 },
    ]);
    expect(d.totalSessions).toBe(21);
    expect(d.trend).toHaveLength(7);
    expect(d.trend.filter((t) => t.sessions > 0)).toEqual([
      { date: "2026-10-26", sessions: 5 },
      { date: "2026-10-27", sessions: 2 },
    ]);
    expect(d.landingPages).toEqual([
      { page: "/build", sessions: 10 },
      { page: "/", sessions: 4 },
    ]);
  });

  it("filters every report to AI-looking sources at Google", async () => {
    connect();
    batch({}, {}, {});
    await getAnalytics("ai", range("7d"), NOW);
    const requests = g.batchRunReports.mock.calls[0][0].requestBody.requests;
    expect(requests).toHaveLength(3);
    for (const req of requests) {
      expect(req.dimensionFilter.filter.fieldName).toBe("sessionSource");
      expect(req.dimensionFilter.filter.stringFilter).toMatchObject({ matchType: "PARTIAL_REGEXP", caseSensitive: false });
      expect(req.dimensionFilter.filter.stringFilter.value).toContain("chatgpt");
    }
    expect(requests[2].dimensions).toEqual([{ name: "landingPage" }, { name: "sessionSource" }, { name: "sessionMedium" }]);
  });

  it("is empty, not an error, when no AI assistant sent anyone", async () => {
    connect();
    batch({}, {}, {});
    const res = await getAnalytics("ai", range("7d"), NOW);
    expect(res).toMatchObject({ ok: true, connected: true, data: { totalSessions: 0, assistants: [], landingPages: [] } });
  });
});

describe("pages", () => {
  it("maps the top pages and the Build a court counts", async () => {
    connect();
    batch(
      report(["pagePath"], ["screenPageViews", "activeUsers", "userEngagementDuration"], [
        ["/", 300, 100, 5000],
        ["/build", 120, 60, 3000],
        ["/empty", 5, 0, 0],
      ]),
      report([], ["activeUsers"], [[60]]),
      report(["eventName"], ["activeUsers", "eventCount"], [["designer_step", 40, 150], ["generate_lead", 7, 7]]),
    );
    const res = await getAnalytics("pages", range("30d"), NOW);
    if (!res.ok || !res.connected) throw new Error("expected data");
    const d = res.data as import("../types").PagesData;

    expect(d.pages).toEqual([
      { path: "/", views: 300, visitors: 100, avgEngagementSec: 50 },
      { path: "/build", views: 120, visitors: 60, avgEngagementSec: 50 },
      { path: "/empty", views: 5, visitors: 0, avgEngagementSec: 0 },
    ]);
    expect(d.buildSteps).toEqual([
      { key: "viewed_build", label: "Looked at Build a court", people: 60 },
      { key: "designer_step", label: "Used the court designer", people: 40 },
      { key: "generate_lead", label: "Sent a form (enquiry or design download)", people: 7 },
      { key: "contact_click", label: "Clicked to contact us", people: 0 }, // no row = nobody
    ]);

    const [pagesReq, buildReq, eventsReq] = g.batchRunReports.mock.calls[0][0].requestBody.requests;
    expect(pagesReq.limit).toBe("15");
    expect(buildReq.dimensionFilter.filter).toEqual({
      fieldName: "pagePath",
      stringFilter: { matchType: "BEGINS_WITH", value: "/build" },
    });
    expect(eventsReq.dimensionFilter.filter.inListFilter.values).toEqual(["designer_step", "generate_lead", "contact_click"]);
  });
});

describe("search", () => {
  const rowsFor = (keys: string[]) => ({
    data: {
      rows: keys.map((k, i) => ({ keys: [k], clicks: 10 - i, impressions: 200 - i, ctr: 0.05123456, position: 4.26 })),
    },
  });

  it("maps top queries and pages, and ends 3 days before today because Google is late", async () => {
    connect();
    g.gscQuery.mockImplementation(async ({ requestBody }: { requestBody: { dimensions: string[] } }) =>
      rowsFor(requestBody.dimensions[0] === "query" ? ["football turf", "box cricket"] : ["https://www.fitoverse.com/build"]),
    );
    const res = await getAnalytics("search", range("30d"), NOW);
    if (!res.ok || !res.connected) throw new Error("expected data");
    const d = res.data as import("../types").SearchData;

    expect(d).toMatchObject({ from: "2026-09-28", to: "2026-10-24", requestedTo: "2026-10-27", delayDays: 3 });
    expect(d.note).toMatch(/3 days behind/);
    expect(d.queries).toEqual([
      { query: "football turf", clicks: 10, impressions: 200, ctr: 0.0512, position: 4.3 },
      { query: "box cricket", clicks: 9, impressions: 199, ctr: 0.0512, position: 4.3 },
    ]);
    expect(d.pages).toEqual([{ page: "https://www.fitoverse.com/build", clicks: 10, impressions: 200, ctr: 0.0512, position: 4.3 }]);

    const calls = g.gscQuery.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.siteUrl === "sc-domain:fitoverse.com")).toBe(true);
    const q = calls.find((c) => c.requestBody.dimensions[0] === "query").requestBody;
    expect(q).toMatchObject({ startDate: "2026-09-28", endDate: "2026-10-24", rowLimit: 25 });
    expect(calls.find((c) => c.requestBody.dimensions[0] === "page").requestBody.rowLimit).toBe(10);
  });

  it("keeps the range's own end when it is already older than the delay", async () => {
    connect();
    g.gscQuery.mockResolvedValue({ data: {} });
    const res = await getAnalytics("search", range("last_month"), NOW);
    expect(res).toMatchObject({ data: { from: "2026-09-01", to: "2026-09-30", requestedTo: "2026-09-30", queries: [], pages: [] } });
  });

  it("asks Google nothing when the whole range is inside the delay", async () => {
    connect();
    const early = new Date("2026-11-02T05:00:00Z"); // this month so far = 1 Nov .. 2 Nov
    const res = await getAnalytics("search", resolveRangeAt("this_month", early), early);
    expect(res).toMatchObject({ ok: true, connected: true, data: { from: "2026-11-01", to: "2026-10-30", queries: [], pages: [] } });
    expect(g.gscQuery).not.toHaveBeenCalled();
  });

  it("uses the Search Console client, not the Analytics one", async () => {
    connect({ GA4_PROPERTY_ID: "" });
    g.gscQuery.mockResolvedValue({ data: {} });
    const res = await getAnalytics("search", range("7d"), NOW);
    expect(res).toMatchObject({ ok: true, connected: true });
    expect(g.batchRunReports).not.toHaveBeenCalled();
  });
});

function resolveRangeAt(preset: string, at: Date): ResolvedRange {
  const out = resolveRange({ range: preset }, at);
  if (!out.ok) throw new Error(out.error);
  return out.range;
}

describe("leadsBySource", () => {
  it("groups the live leads of the range by where they came from, null as Unknown", async () => {
    db.websiteLead.groupBy.mockResolvedValue([
      { cameFrom: "Google search", cameFromGroup: "Search", _count: { _all: 5 } },
      { cameFrom: "ChatGPT", cameFromGroup: "AI assistants", _count: { _all: 3 } },
      { cameFrom: null, cameFromGroup: null, _count: { _all: 8 } },
      { cameFrom: "Direct", cameFromGroup: "Direct", _count: { _all: 2 } },
      { cameFrom: "Perplexity", cameFromGroup: "AI assistants", _count: { _all: 1 } },
    ]);
    const res = await getAnalytics("leadsBySource", range("30d"), NOW);
    expect(res).toMatchObject({ ok: true, connected: true, section: "leadsBySource", range: range("30d") });
    if (!res.ok || !res.connected) throw new Error("expected data");
    expect(res.data).toEqual({
      total: 19,
      sources: [
        { label: "Unknown", group: "Unknown", count: 8 },
        { label: "Google search", group: "Search", count: 5 },
        { label: "ChatGPT", group: "AI assistants", count: 3 },
        { label: "Direct", group: "Direct", count: 2 },
        { label: "Perplexity", group: "AI assistants", count: 1 },
      ],
      groups: [
        { group: "Unknown", count: 8 },
        { group: "Search", count: 5 },
        { group: "AI assistants", count: 4 },
        { group: "Direct", count: 2 },
      ],
    });
    const args = db.websiteLead.groupBy.mock.calls[0][0];
    expect(args.by).toEqual(["cameFrom", "cameFromGroup"]);
    expect(args.where.AND).toContainEqual({ deletedAt: null });
  });

  it("is not cached (a new lead shows at once)", async () => {
    await getAnalytics("leadsBySource", range("30d"), NOW);
    expect(cache.calls).toHaveLength(0);
  });
});

describe("failures", () => {
  const googleError = (code: number | string, message = "Request failed with secret detail") =>
    Object.assign(new Error(message), {
      code,
      config: { headers: { Authorization: "Bearer ya29.SECRET-TOKEN" } },
    });

  it.each([
    [403, /didn't allow access/i],
    [401, /didn't allow access/i],
    [404, /couldn't find/i],
    [429, /limiting requests/i],
    ["ETIMEDOUT", /took too long/i],
    [500, /couldn't load analytics/i],
  ])("a Google %s becomes a friendly message with nothing from Google in it", async (code, expected) => {
    connect();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    g.batchRunReports.mockRejectedValueOnce(googleError(code));

    const res = await getAnalytics("sources", range("30d"), NOW);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(expected) });
    expect(JSON.stringify(res)).not.toMatch(/secret|token|Bearer|Request failed/i);

    // The server log keeps the status and message, but never the request (which carries the access token).
    const logged = log.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("sources failed");
    expect(logged).not.toMatch(/Bearer|SECRET-TOKEN|private/i);
  });

  it("never logs or returns the service-account key", async () => {
    connect();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    g.batchRunReports.mockRejectedValueOnce(googleError(500, `bad key ${KEY}`));
    const res = await getAnalytics("pages", range("30d"), NOW);
    expect(JSON.stringify(res)).not.toContain("top-secret-key");
    expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("top-secret-key");
  });

  it("a search failure is friendly too", async () => {
    connect();
    vi.spyOn(console, "error").mockImplementation(() => {});
    g.gscQuery.mockRejectedValue(googleError(403));
    expect(await getAnalytics("search", range("30d"), NOW)).toEqual({ ok: false, error: expect.stringMatching(/didn't allow access/i) });
  });

  it("settings that are present but unusable say so without echoing them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    connect({ GOOGLE_ANALYTICS_CREDENTIALS: "not-a-key" });
    const bad = await getAnalytics("overview", range("30d"), NOW);
    expect(bad).toEqual({ ok: false, error: expect.stringMatching(/settings look wrong/i) });
    expect(JSON.stringify(bad)).not.toContain("not-a-key");

    connect({ GA4_PROPERTY_ID: "my-site" });
    expect(await getAnalytics("live", null, NOW)).toEqual({ ok: false, error: expect.stringMatching(/settings look wrong/i) });
    expect(g.runRealtimeReport).not.toHaveBeenCalled();
  });

  it("a database failure is a friendly error too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.websiteLead.groupBy.mockRejectedValue(new Error("column came_from does not exist"));
    const res = await getAnalytics("leadsBySource", range("30d"), NOW);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/couldn't load analytics/i) });
    expect(JSON.stringify(res)).not.toContain("came_from");
  });

  it("accepts a property id written as properties/123", async () => {
    connect({ GA4_PROPERTY_ID: "properties/555" });
    batch({}, {}, {});
    await getAnalytics("pages", range("7d"), NOW);
    expect(g.batchRunReports.mock.calls[0][0].property).toBe("properties/555");
  });
});
