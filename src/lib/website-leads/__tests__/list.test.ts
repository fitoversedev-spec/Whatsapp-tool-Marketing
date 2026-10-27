import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  websiteLead: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  websiteLeadToLabel: { groupBy: vi.fn() },
  metaLeadLabel: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  WEBSITE_LEADS_PAGE_SIZE,
  buildWebsiteLeadWhere,
  getWebsiteLeadDetail,
  getWebsiteLeadExportRows,
  getWebsiteLeadFacets,
  getWebsiteLeadPage,
  type WebsiteLeadFilters,
} from "../list";

const from = new Date("2026-10-01T00:00:00Z");
const to = new Date("2026-10-31T23:59:59Z");
const base = { deletedAt: null };
const range = { receivedAt: { gte: from, lte: to } };

const and = (f: Partial<WebsiteLeadFilters>) => (buildWebsiteLeadWhere({ from, to, ...f }).AND as unknown[]).slice(2);

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
});

describe("buildWebsiteLeadWhere", () => {
  it("always hides deleted leads and applies the received-date range", () => {
    expect(buildWebsiteLeadWhere({ from, to })).toEqual({ AND: [base, range] });
  });

  it("city and sport are case-insensitive contains", () => {
    expect(and({ city: " Pune ", sport: "Foot" })).toEqual([
      { city: { contains: "Pune", mode: "insensitive" } },
      { sport: { contains: "Foot", mode: "insensitive" } },
    ]);
  });

  it("escapes % _ and \\ in contains filters so they match literally", () => {
    expect(and({ city: "100%" })).toEqual([{ city: { contains: "100\\%", mode: "insensitive" } }]);
    expect(and({ sport: "multi_sport" })).toEqual([{ sport: { contains: "multi\\_sport", mode: "insensitive" } }]);
    expect(and({ city: "a\\b" })).toEqual([{ city: { contains: "a\\\\b", mode: "insensitive" } }]);
    expect(and({ assigned: "50%_rep" })).toEqual([
      { assignedTo: { name: { contains: "50\\%\\_rep", mode: "insensitive" } } },
    ]);
    const [search] = and({ q: "100%_x" }) as { OR: unknown[] }[];
    expect(search.OR).toContainEqual({ name: { contains: "100\\%\\_x", mode: "insensitive" } });
    expect(search.OR).toContainEqual({ email: { contains: "100\\%\\_x", mode: "insensitive" } });
    expect(search.OR).toContainEqual({ phone: { contains: "100\\%\\_x" } });
  });

  it("court size range: min, max or both", () => {
    expect(and({ areaMin: 1000, areaMax: 5000 })).toEqual([{ areaSqft: { gte: 1000, lte: 5000 } }]);
    expect(and({ areaMin: 1000 })).toEqual([{ areaSqft: { gte: 1000 } }]);
    expect(and({ areaMax: 0 })).toEqual([{ areaSqft: { lte: 0 } }]);
  });

  it("stage and label are exact", () => {
    expect(and({ stage: "QUALIFIED", label: "Hot" })).toEqual([
      { stage: "QUALIFIED" },
      { labels: { some: { label: { name: "Hot" } } } },
    ]);
  });

  it("rep: unassigned, a user id, or part of a name", () => {
    expect(and({ assigned: "Unassigned" })).toEqual([{ assignedToUserId: null }]);
    const id = "2f1b6c7e-8a49-4d3c-9e51-0a7b6c5d4e3f";
    expect(and({ assigned: id })).toEqual([{ assignedToUserId: id }]);
    expect(and({ assigned: "ravi" })).toEqual([{ assignedTo: { name: { contains: "ravi", mode: "insensitive" } } }]);
  });

  it("search matches name, email and phone, and the digits of a typed number", () => {
    const [search] = and({ q: "+91 98765-43210" }) as { OR: unknown[] }[];
    expect(search.OR).toContainEqual({ normalizedPhone: { contains: "919876543210" } });
    const [short] = and({ q: "ab" }) as { OR: unknown[] }[];
    expect(short.OR).toHaveLength(3);
  });

  it("blank filters add nothing", () => {
    expect(and({ city: "  ", sport: "", assigned: " ", q: " ", stage: "", label: "" })).toEqual([]);
  });
});

describe("getWebsiteLeadPage", () => {
  const row = (id: string) => ({
    id,
    name: "Asha",
    phone: "+919876543210",
    normalizedPhone: "919876543210",
    email: null,
    city: "Pune",
    state: null,
    sport: "Football",
    areaSqft: 1200,
    lengthFt: null,
    widthFt: null,
    startWhen: null,
    stage: "NEW",
    assignedToUserId: null,
    accountContactId: null,
    contactId: null,
    receivedAt: new Date("2026-10-05T10:00:00Z"),
    assignedTo: null,
    labels: [],
  });

  it("pages 50 at a time, newest first", async () => {
    db.websiteLead.count.mockResolvedValue(120);
    db.websiteLead.findMany.mockResolvedValue([row("a")]);
    const page = await getWebsiteLeadPage({ from, to }, 3);
    expect(WEBSITE_LEADS_PAGE_SIZE).toBe(50);
    expect(db.websiteLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 50, orderBy: [{ receivedAt: "desc" }, { id: "asc" }] }),
    );
    expect(page).toMatchObject({ total: 120, page: 3, pageCount: 3 });
    expect(page.rows[0]).toMatchObject({ id: "a", inCrm: false, inMarketing: false, receivedAt: "2026-10-05T10:00:00.000Z", badges: [] });
  });

  it("shows the last page when the asked-for page no longer exists", async () => {
    db.websiteLead.count.mockResolvedValue(51);
    db.websiteLead.findMany.mockResolvedValue([row("a")]);
    const page = await getWebsiteLeadPage({ from, to }, 9);
    expect(page.page).toBe(2);
    expect(db.websiteLead.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 50 }));
  });
});

// ---------------------------------------------------------------------------
// Where the lead came from (cameFrom)
// ---------------------------------------------------------------------------

describe("cameFrom filter", () => {
  it("a label is an exact match, in any case", () => {
    expect(and({ cameFrom: "ChatGPT" })).toEqual([{ cameFrom: { equals: "ChatGPT", mode: "insensitive" } }]);
    expect(and({ cameFrom: " google search " })).toEqual([{ cameFrom: { equals: "google search", mode: "insensitive" } }]);
  });

  it("'unknown' means the leads that have no attribution", () => {
    expect(and({ cameFrom: "unknown" })).toEqual([{ cameFrom: null }]);
    expect(and({ cameFrom: "Unknown" })).toEqual([{ cameFrom: null }]);
  });

  it("blank adds nothing", () => {
    expect(and({ cameFrom: "  " })).toEqual([]);
    expect(and({ cameFrom: "" })).toEqual([]);
  });

  it("combines with the other filters", () => {
    expect(and({ cameFrom: "Direct", stage: "NEW" })).toEqual([
      { stage: "NEW" },
      { cameFrom: { equals: "Direct", mode: "insensitive" } },
    ]);
  });
});

describe("rows carry cameFrom", () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    id: "a",
    name: "Asha",
    phone: "+919876543210",
    normalizedPhone: "919876543210",
    email: null,
    city: "Pune",
    state: null,
    sport: "Football",
    areaSqft: 1200,
    lengthFt: null,
    widthFt: null,
    startWhen: null,
    stage: "NEW",
    assignedToUserId: null,
    accountContactId: null,
    contactId: null,
    receivedAt: new Date("2026-10-05T10:00:00Z"),
    assignedTo: null,
    labels: [],
    ...over,
  });

  it("selects and returns the label and its group; no attribution is null", async () => {
    db.websiteLead.count.mockResolvedValue(2);
    db.websiteLead.findMany.mockResolvedValue([
      lead({ id: "a", cameFrom: "ChatGPT", cameFromGroup: "AI assistants" }),
      lead({ id: "b", cameFrom: null, cameFromGroup: null }),
    ]);
    const page = await getWebsiteLeadPage({ from, to }, 1);
    expect(db.websiteLead.findMany.mock.calls[0][0].select).toMatchObject({ cameFrom: true, cameFromGroup: true });
    expect(page.rows[0]).toMatchObject({ id: "a", cameFrom: "ChatGPT", cameFromGroup: "AI assistants" });
    expect(page.rows[1]).toMatchObject({ id: "b", cameFrom: null, cameFromGroup: null });
  });
});

describe("cameFrom facets", () => {
  const groups = (by: string[]) => {
    switch (by[0]) {
      case "city":
        return [{ city: "Pune", _count: { _all: 7 } }];
      case "sport":
        return [{ sport: "Football", _count: { _all: 7 } }];
      case "assignedToUserId":
        return [{ assignedToUserId: null, _count: { _all: 7 } }];
      case "stage":
        return [{ stage: "NEW", _count: { _all: 7 } }];
      default:
        return [
          { cameFrom: "Google search", _count: { _all: 2 } },
          { cameFrom: "ChatGPT", _count: { _all: 5 } },
          { cameFrom: null, _count: { _all: 4 } },
          { cameFrom: "chatgpt", _count: { _all: 1 } },
        ];
    }
  };

  beforeEach(() => {
    db.websiteLead.groupBy.mockImplementation(async ({ by }: { by: string[] }) => groups(by));
    db.websiteLead.count.mockResolvedValue(7);
    db.websiteLeadToLabel.groupBy.mockResolvedValue([]);
  });

  it("counts leads per source, biggest first, with no attribution as Unknown", async () => {
    const { options, breakdown } = await getWebsiteLeadFacets({ from, to }, { options: true, breakdown: true });
    const expected = [
      { key: "chatgpt", label: "ChatGPT", count: 6 },
      { key: "unknown", label: "Unknown", count: 4 },
      { key: "google search", label: "Google search", count: 2 },
    ];
    expect(options?.cameFrom).toEqual(expected);
    expect(breakdown?.cameFrom).toEqual(expected);
    expect(breakdown).toMatchObject({ city: [{ label: "Pune", count: 7 }] });
  });

  it("the dropdown options always cover the whole date window, the breakdown follows the filters", async () => {
    await getWebsiteLeadFacets({ from, to, cameFrom: "ChatGPT" }, { options: true, breakdown: true });
    const cameFromCalls = db.websiteLead.groupBy.mock.calls.filter(([a]) => a.by[0] === "cameFrom").map(([a]) => a.where.AND);
    expect(cameFromCalls).toHaveLength(2);
    const filtered = cameFromCalls.filter((w: unknown[]) => w.some((c) => JSON.stringify(c).includes("insensitive")));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toContainEqual({ cameFrom: { equals: "ChatGPT", mode: "insensitive" } });
  });

  it("a cameFrom filter alone counts as a dropdown filter", async () => {
    const { breakdown } = await getWebsiteLeadFacets({ from, to, cameFrom: "unknown" }, { breakdown: true });
    expect(breakdown?.cameFrom).toBeDefined();
    // Not served from the unfiltered options: the filtered set was counted with its own where.
    const wheres = db.websiteLead.groupBy.mock.calls.map(([a]) => JSON.stringify(a.where));
    expect(wheres.every((w) => w.includes('"cameFrom":null'))).toBe(true);
  });
});

describe("export rows", () => {
  const exportLead = (over: Record<string, unknown> = {}) => ({
    name: "Asha",
    phone: "+919876543210",
    email: null,
    city: "Pune",
    state: null,
    jobTitle: null,
    sport: "Football",
    areaSqft: null,
    lengthFt: null,
    widthFt: null,
    startWhen: null,
    surface: null,
    notes: null,
    cameFrom: null,
    landingPage: null,
    attribution: null,
    stage: "NEW",
    accountContactId: null,
    receivedAt: new Date("2026-10-05T10:00:00Z"),
    assignedTo: null,
    labels: [],
    ...over,
  });

  it("adds Came from, Campaign (utm_campaign) and Landing page", async () => {
    db.websiteLead.count.mockResolvedValue(3);
    db.websiteLead.findMany.mockResolvedValue([
      exportLead({
        cameFrom: "Google Ads",
        landingPage: "/build",
        attribution: JSON.stringify({ referrer: null, utm_source: "google", utm_campaign: "turf-oct" }),
      }),
      exportLead({ cameFrom: "Direct", landingPage: "/", attribution: JSON.stringify({ utm_campaign: null }) }),
      exportLead(),
    ]);
    const { rows, total } = await getWebsiteLeadExportRows({ from, to });
    expect(total).toBe(3);
    expect(db.websiteLead.findMany.mock.calls[0][0].select).toMatchObject({ cameFrom: true, landingPage: true, attribution: true });
    expect(rows.map((r) => [r.cameFrom, r.campaign, r.landingPage])).toEqual([
      ["Google Ads", "turf-oct", "/build"],
      ["Direct", null, "/"],
      [null, null, null],
    ]);
  });

  it("an unreadable stored attribution just leaves the campaign empty", async () => {
    db.websiteLead.count.mockResolvedValue(2);
    db.websiteLead.findMany.mockResolvedValue([exportLead({ attribution: "{oops" }), exportLead({ attribution: "[1]" })]);
    const { rows } = await getWebsiteLeadExportRows({ from, to });
    expect(rows.map((r) => r.campaign)).toEqual([null, null]);
  });
});

describe("detail", () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    id: "a",
    name: "Asha",
    phone: "+919876543210",
    normalizedPhone: "919876543210",
    email: null,
    city: "Pune",
    state: null,
    sport: "Football",
    areaSqft: null,
    lengthFt: null,
    widthFt: null,
    startWhen: null,
    stage: "NEW",
    assignedToUserId: null,
    accountContactId: null,
    contactId: null,
    receivedAt: new Date("2026-10-05T10:00:00Z"),
    assignedTo: null,
    labels: [],
    jobTitle: null,
    notes: null,
    answers: [],
    surface: null,
    env: null,
    source: "fitoverse.com/build",
    internalNotes: [],
    cameFrom: null,
    cameFromGroup: null,
    landingPage: null,
    attribution: null,
    ...over,
  });

  it("returns where it came from and the stored attribution", async () => {
    const stored = {
      referrer: "https://chatgpt.com/",
      landing_page: "/build",
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      click_id: null,
      first_seen_at: "2026-10-05T09:58:00.000Z",
    };
    db.websiteLead.findFirst.mockResolvedValue(
      detail({ cameFrom: "ChatGPT", cameFromGroup: "AI assistants", landingPage: "/build", attribution: JSON.stringify(stored) }),
    );
    const d = await getWebsiteLeadDetail("a");
    expect(d).toMatchObject({ cameFrom: "ChatGPT", cameFromGroup: "AI assistants", landingPage: "/build", attribution: stored });
    expect(db.websiteLead.findFirst.mock.calls[0][0].select).toMatchObject({ landingPage: true, attribution: true });
  });

  it("an older lead has no attribution", async () => {
    db.websiteLead.findFirst.mockResolvedValue(detail());
    expect(await getWebsiteLeadDetail("a")).toMatchObject({ cameFrom: null, landingPage: null, attribution: null });
  });
});
