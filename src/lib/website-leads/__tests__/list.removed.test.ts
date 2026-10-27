import { beforeEach, describe, expect, it, vi } from "vitest";

// Removed leads (deletedAt set): hidden by default, listed by the `removed` filter,
// readable by id only when the caller passes includeRemoved.
const db = vi.hoisted(() => ({
  websiteLead: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  websiteLeadToLabel: { groupBy: vi.fn() },
  metaLeadLabel: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  buildWebsiteLeadWhere,
  getWebsiteLeadDetail,
  getWebsiteLeadExportRows,
  getWebsiteLeadFacets,
  getWebsiteLeadIds,
  getWebsiteLeadPage,
} from "../list";

const from = new Date("2026-10-01T00:00:00Z");
const to = new Date("2026-10-31T23:59:59Z");
const live = { deletedAt: null };
const removedOnly = { deletedAt: { not: null } };
const range = { receivedAt: { gte: from, lte: to } };

const lead = (over: Record<string, unknown> = {}) => ({
  id: "r1",
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
  deletedAt: new Date("2026-10-20T08:15:00Z"),
  assignedTo: null,
  labels: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
});

describe("buildWebsiteLeadWhere", () => {
  it("by default (or removed false) only the leads that are not removed", () => {
    expect(buildWebsiteLeadWhere({ from, to })).toEqual({ AND: [live, range] });
    expect(buildWebsiteLeadWhere({ from, to, removed: false })).toEqual({ AND: [live, range] });
  });

  it("removed: only the removed leads, with the date range and every other filter still applied", () => {
    expect(buildWebsiteLeadWhere({ from, to, removed: true })).toEqual({ AND: [removedOnly, range] });
    const { AND } = buildWebsiteLeadWhere({ from, to, removed: true, city: "Pune", stage: "NEW", cameFrom: "ChatGPT", q: "asha" });
    expect(AND).toHaveLength(6);
    expect((AND as unknown[]).slice(0, 5)).toEqual([
      removedOnly,
      range,
      { city: { contains: "Pune", mode: "insensitive" } },
      { stage: "NEW" },
      { cameFrom: { equals: "ChatGPT", mode: "insensitive" } },
    ]);
  });
});

describe("the page", () => {
  it("lists only removed leads, carries when each was removed, and reads the column only then", async () => {
    db.websiteLead.count.mockResolvedValue(1);
    db.websiteLead.findMany.mockResolvedValue([lead()]);
    const page = await getWebsiteLeadPage({ from, to, removed: true }, 1);
    const args = db.websiteLead.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toEqual(removedOnly);
    expect(db.websiteLead.count).toHaveBeenCalledWith({ where: args.where });
    expect(args.select.deletedAt).toBe(true);
    expect(page.rows[0]).toMatchObject({ id: "r1", removedAt: "2026-10-20T08:15:00.000Z" });
    expect(page).toMatchObject({ total: 1, page: 1, pageCount: 1 });
  });

  it("the default list excludes removed leads, never selects the column and has no removedAt", async () => {
    db.websiteLead.count.mockResolvedValue(1);
    db.websiteLead.findMany.mockResolvedValue([lead({ deletedAt: undefined })]);
    const page = await getWebsiteLeadPage({ from, to }, 1);
    const args = db.websiteLead.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toEqual(live);
    expect(args.select.deletedAt).toBeUndefined();
    expect(page.rows[0].removedAt).toBeNull();
  });

  it("keeps paging on the removed set", async () => {
    db.websiteLead.count.mockResolvedValue(120);
    db.websiteLead.findMany.mockResolvedValue([lead()]);
    const page = await getWebsiteLeadPage({ from, to, removed: true }, 3);
    expect(db.websiteLead.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 50 }));
    expect(page).toMatchObject({ total: 120, page: 3, pageCount: 3 });
  });
});

describe("ids and export", () => {
  it("'Select all N matching' ids come from the removed set, with the other filters", async () => {
    db.websiteLead.count.mockResolvedValue(2);
    db.websiteLead.findMany.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);
    expect(await getWebsiteLeadIds({ from, to, removed: true, city: "Pune" })).toEqual({ ids: ["r1", "r2"], total: 2 });
    const where = db.websiteLead.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual(removedOnly);
    expect(where.AND).toContainEqual({ city: { contains: "Pune", mode: "insensitive" } });
    expect(db.websiteLead.count).toHaveBeenCalledWith({ where });
  });

  it("the export covers the removed set", async () => {
    db.websiteLead.count.mockResolvedValue(0);
    db.websiteLead.findMany.mockResolvedValue([]);
    await getWebsiteLeadExportRows({ from, to, removed: true });
    expect(db.websiteLead.findMany.mock.calls[0][0].where.AND[0]).toEqual(removedOnly);
  });

  it("both default to the live set", async () => {
    db.websiteLead.count.mockResolvedValue(0);
    db.websiteLead.findMany.mockResolvedValue([]);
    await getWebsiteLeadIds({ from, to });
    await getWebsiteLeadExportRows({ from, to });
    expect(db.websiteLead.findMany).toHaveBeenCalledTimes(2);
    for (const [args] of db.websiteLead.findMany.mock.calls) expect(args.where.AND[0]).toEqual(live);
  });
});

describe("options and breakdown", () => {
  beforeEach(() => {
    db.websiteLead.groupBy.mockResolvedValue([]);
    db.websiteLead.count.mockResolvedValue(0);
    db.websiteLeadToLabel.groupBy.mockResolvedValue([]);
  });

  const everyWhere = () => [
    ...db.websiteLead.groupBy.mock.calls.map(([a]) => a.where),
    ...db.websiteLead.count.mock.calls.map(([a]) => a.where),
    ...db.websiteLeadToLabel.groupBy.mock.calls.map(([a]) => a.where.websiteLead),
  ];

  it("describe the removed set, with and without a dropdown filter", async () => {
    await getWebsiteLeadFacets({ from, to, removed: true }, { options: true, breakdown: true });
    await getWebsiteLeadFacets({ from, to, removed: true, city: "Pune" }, { options: true, breakdown: true });
    const wheres = everyWhere();
    expect(wheres.length).toBeGreaterThan(6);
    for (const w of wheres) expect(w.AND[0]).toEqual(removedOnly);
  });

  it("describe the live set by default", async () => {
    await getWebsiteLeadFacets({ from, to, city: "Pune" }, { options: true, breakdown: true });
    const wheres = everyWhere();
    expect(wheres.length).toBeGreaterThan(6);
    for (const w of wheres) expect(w.AND[0]).toEqual(live);
  });
});

describe("the detail", () => {
  const detailRow = (over: Record<string, unknown> = {}) => ({
    ...lead(),
    jobTitle: null,
    notes: null,
    answers: [],
    surface: null,
    env: null,
    source: null,
    internalNotes: [],
    cameFrom: null,
    cameFromGroup: null,
    landingPage: null,
    attribution: null,
    ...over,
  });

  // A database that returns the removed lead only when the query does not filter it out.
  beforeEach(() => {
    db.websiteLead.findFirst.mockImplementation(async ({ where }: { where: { deletedAt?: null } }) =>
      where.deletedAt === null ? null : detailRow(),
    );
  });

  it("is not found by default: a removed lead stays hidden", async () => {
    expect(await getWebsiteLeadDetail("r1")).toBeNull();
    expect(await getWebsiteLeadDetail("r1", {})).toBeNull();
    expect(await getWebsiteLeadDetail("r1", { includeRemoved: false })).toBeNull();
    expect(db.websiteLead.findFirst).toHaveBeenCalledTimes(3);
    for (const [args] of db.websiteLead.findFirst.mock.calls) {
      expect(args.where).toEqual({ id: "r1", deletedAt: null });
      expect(args.select.deletedAt).toBeUndefined();
    }
  });

  it("includeRemoved opens it, with the date it was removed", async () => {
    const d = await getWebsiteLeadDetail("r1", { includeRemoved: true });
    expect(d).toMatchObject({ id: "r1", removedAt: "2026-10-20T08:15:00.000Z" });
    const args = db.websiteLead.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: "r1" });
    expect(args.select.deletedAt).toBe(true);
  });

  it("a lead that is not removed has no removedAt, whichever way it is read", async () => {
    db.websiteLead.findFirst.mockResolvedValue(detailRow({ deletedAt: null }));
    expect((await getWebsiteLeadDetail("r1", { includeRemoved: true }))?.removedAt).toBeNull();
    expect((await getWebsiteLeadDetail("r1"))?.removedAt).toBeNull();
  });
});
