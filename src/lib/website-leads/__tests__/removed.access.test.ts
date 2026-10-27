import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Who can see removed leads: the list's `removed` param and the lead's own page.
// The database is a stand-in that only returns a removed lead when the query does
// not filter it out, so these tests pin what each role's request actually asks for.
const db = vi.hoisted(() => ({
  websiteLead: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  websiteLeadToLabel: { groupBy: vi.fn() },
  metaLeadLabel: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
const badges = vi.hoisted(() => ({ getBadgesForLeads: vi.fn(), getBadgesForLead: vi.fn() }));
vi.mock("@/lib/website-leads/badges", () => badges);

import { GET as listRoute } from "@/app/api/website-leads/route";
import { GET as detailRoute } from "@/app/api/website-leads/[id]/route";

const REMOVED_AT = new Date("2026-10-20T08:15:00Z");
const row = (over: Record<string, unknown> = {}) => ({
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
  assignedTo: null,
  labels: [],
  ...over,
});
const detailRow = (over: Record<string, unknown> = {}) => ({
  ...row(over),
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
});

const asRole = (role: string) => auth.getCurrentUser.mockResolvedValue({ id: `u-${role}`, role });
const firstWhere = (mock: { mock: { calls: unknown[][] } }) =>
  (mock.mock.calls[0][0] as { where: { AND: unknown[] } }).where.AND[0];
const list = (qs: string) => listRoute(new NextRequest(`http://crm.test/api/website-leads${qs}`));
const detail = (id = "r1") =>
  detailRoute(new NextRequest(`http://crm.test/api/website-leads/${id}`), { params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  asRole("admin");
  badges.getBadgesForLeads.mockResolvedValue(new Map());
  badges.getBadgesForLead.mockResolvedValue([]);
  db.websiteLead.count.mockResolvedValue(1);
  db.websiteLead.groupBy.mockResolvedValue([]);
  db.websiteLeadToLabel.groupBy.mockResolvedValue([]);
  // Removed rows come back only when the query is not limited to live leads.
  db.websiteLead.findMany.mockImplementation(async (args: { where: { AND: { deletedAt?: unknown }[] } }) =>
    args.where.AND[0].deletedAt === null ? [row({ id: "live" })] : [{ ...row(), deletedAt: REMOVED_AT }],
  );
  db.websiteLead.findFirst.mockImplementation(async (args: { where: { deletedAt?: unknown } }) =>
    args.where.deletedAt === null ? null : { ...detailRow(), deletedAt: REMOVED_AT },
  );
});

describe("GET /api/website-leads?removed=1", () => {
  it.each(["admin", "manager"])("%s gets only the removed leads, each with removedAt", async (role) => {
    asRole(role);
    const res = await list("?removed=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ id: "r1", removedAt: REMOVED_AT.toISOString() });
    expect(firstWhere(db.websiteLead.findMany)).toEqual({ deletedAt: { not: null } });
    expect(firstWhere(db.websiteLead.count)).toEqual({ deletedAt: { not: null } });
  });

  it.each(["sales", "management"])("is ignored for %s: the normal list, no removedAt", async (role) => {
    asRole(role);
    const body = await (await list("?removed=1")).json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["live"]);
    expect(body.rows[0].removedAt).toBeNull();
    expect(firstWhere(db.websiteLead.findMany)).toEqual({ deletedAt: null });
    expect(db.websiteLead.findMany.mock.calls[0][0].select.deletedAt).toBeUndefined();
  });

  it.each(["", "?removed=0", "?removed=", "?removed=true", "?removed=yes"])("%s leaves the normal list for an admin", async (qs) => {
    await list(qs);
    expect(firstWhere(db.websiteLead.findMany)).toEqual({ deletedAt: null });
  });

  it("still applies the other filters and paging to the removed set", async () => {
    await list("?removed=1&city=Pune&stage=NEW&page=2");
    const args = db.websiteLead.findMany.mock.calls[0][0];
    expect(args.where.AND).toContainEqual({ city: { contains: "Pune", mode: "insensitive" } });
    expect(args.where.AND).toContainEqual({ stage: "NEW" });
    expect(args).toMatchObject({ skip: 50, take: 50 });
  });

  it("idsOnly and export follow the same rule", async () => {
    for (const mode of ["idsOnly", "export"]) {
      db.websiteLead.findMany.mockClear();
      asRole("manager");
      await list(`?removed=1&${mode}=1`);
      expect(firstWhere(db.websiteLead.findMany), `${mode} (manager)`).toEqual({ deletedAt: { not: null } });
      db.websiteLead.findMany.mockClear();
      asRole("sales");
      await list(`?removed=1&${mode}=1`);
      expect(firstWhere(db.websiteLead.findMany), `${mode} (sales)`).toEqual({ deletedAt: null });
    }
  });

  it("the dropdown options and breakdown describe the removed set for a manager, the live set for sales", async () => {
    asRole("manager");
    await list("?removed=1&options=1&facets=1");
    const wheres = db.websiteLead.groupBy.mock.calls.map(([a]) => a.where.AND[0]);
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) expect(w).toEqual({ deletedAt: { not: null } });

    db.websiteLead.groupBy.mockClear();
    asRole("sales");
    await list("?removed=1&options=1&facets=1");
    const salesWheres = db.websiteLead.groupBy.mock.calls.map(([a]) => a.where.AND[0]);
    expect(salesWheres.length).toBeGreaterThan(0);
    for (const w of salesWheres) expect(w).toEqual({ deletedAt: null });
  });

  it("401 when signed out", async () => {
    auth.getCurrentUser.mockResolvedValue(null);
    expect((await list("?removed=1")).status).toBe(401);
    expect(db.websiteLead.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/website-leads/[id] for a removed lead", () => {
  it.each(["admin", "manager"])("%s can open it, and it says when it was removed", async (role) => {
    asRole(role);
    const res = await detail();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "r1", removedAt: REMOVED_AT.toISOString() });
    expect(db.websiteLead.findFirst.mock.calls[0][0].where).toEqual({ id: "r1" });
  });

  it.each(["sales", "management"])("is a 404 for %s", async (role) => {
    asRole(role);
    const res = await detail();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(db.websiteLead.findFirst.mock.calls[0][0].where).toEqual({ id: "r1", deletedAt: null });
  });

  it("a lead that is not removed opens for everyone, with no removedAt", async () => {
    db.websiteLead.findFirst.mockResolvedValue(detailRow());
    for (const role of ["admin", "manager", "sales"]) {
      asRole(role);
      const res = await detail();
      expect(res.status, role).toBe(200);
      expect((await res.json()).removedAt, role).toBeNull();
    }
  });

  it("401 when signed out", async () => {
    auth.getCurrentUser.mockResolvedValue(null);
    expect((await detail()).status).toBe(401);
    expect(db.websiteLead.findFirst).not.toHaveBeenCalled();
  });
});
