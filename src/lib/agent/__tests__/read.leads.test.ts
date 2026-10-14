import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, getContactTimeline, findAccountDuplicate, findAccountContactDuplicate, contactsMatchingPhone } = vi.hoisted(() => ({
  db: {
    accountContact: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    activity: { groupBy: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    deal: { findMany: vi.fn() },
    accountContactNote: { findMany: vi.fn() },
    contactNextAction: { findMany: vi.fn() },
    reminder: { findMany: vi.fn() },
    contactProductInterest: { findMany: vi.fn() },
    quotation: { findMany: vi.fn() },
    courtImage: { findMany: vi.fn() },
    contact: { findUnique: vi.fn() },
    metaLead: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  getContactTimeline: vi.fn(),
  findAccountDuplicate: vi.fn(),
  findAccountContactDuplicate: vi.fn(),
  contactsMatchingPhone: vi.fn(),
}));

// Tables the agent must never read: touching them throws.
const FORBIDDEN_TABLES = ["contactInsight", "accountContactAttachment", "contactEvent", "portfolioProject", "user", "setting"];
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(db, {
    get(target, prop: string) {
      if (FORBIDDEN_TABLES.includes(prop)) throw new Error(`agent read touched forbidden table: ${prop}`);
      return (target as Record<string, unknown>)[prop];
    },
  }),
}));
vi.mock("@/lib/crm/timeline", () => ({ getContactTimeline }));
vi.mock("@/lib/crm/accounts", () => ({ findAccountDuplicate, findAccountContactDuplicate }));
vi.mock("@/lib/crm/contactLinks", () => ({ contactsMatchingPhone }));

import { AgentHttpError } from "../errors";
import { checkDuplicates, getLead, getLeadTimeline, searchLeads } from "../read/leads";

const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = new Date("2026-09-01T10:00:00.000Z");

const leadRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Lead ${id.slice(0, 2)}`,
  phone: "+919876543210",
  pipelineStage: "LEAD",
  createdAt: D,
  leadStage: { id: "s1", name: "New" },
  leadSource: { name: "Meta" },
  account: { name: "Co", city: "Pune", owner: { id: "u1", name: "Priya" } },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchLeads", () => {
  it("asks for one extra row to know there is a next page, and returns a cursor", async () => {
    db.accountContact.findMany.mockResolvedValue([leadRow(C1), leadRow(C2), leadRow(C3)]);
    db.activity.groupBy.mockResolvedValue([{ accountContactId: C1, _max: { occurredAt: D } }]);
    const r = await searchLeads({ limit: 2 });
    const args = db.accountContact.findMany.mock.calls[0][0];
    expect(args.take).toBe(3);
    expect(args.cursor).toBeUndefined();
    expect(r.items.map((i) => i.id)).toEqual([C1, C2]);
    expect(r.nextCursor).toBe(C2);
    expect(r.items[0].lastActivityAt).toBe(D.toISOString());
    expect(r.items[1].lastActivityAt).toBeNull();
  });

  it("continues after the cursor and ends with a null cursor", async () => {
    db.accountContact.findMany.mockResolvedValue([leadRow(C3)]);
    db.activity.groupBy.mockResolvedValue([]);
    const r = await searchLeads({ limit: 2, cursor: C2 });
    const args = db.accountContact.findMany.mock.calls[0][0];
    expect(args.cursor).toEqual({ id: C2 });
    expect(args.skip).toBe(1);
    expect(r.nextCursor).toBeNull();
  });

  it("returns only live leads unless asked for other customers too", async () => {
    db.accountContact.findMany.mockResolvedValue([]);
    await searchLeads({ limit: 5 });
    const and1 = db.accountContact.findMany.mock.calls[0][0].where.AND;
    expect(and1).toContainEqual({ pipelineStage: "LEAD" });
    expect(and1).toContainEqual({ deletedAt: null, account: { deletedAt: null } });

    await searchLeads({ limit: 5, includeContacts: true });
    const and2 = db.accountContact.findMany.mock.calls[1][0].where.AND;
    expect(and2).not.toContainEqual({ pipelineStage: "LEAD" });
  });

  it("does not run the activity query when there are no rows", async () => {
    db.accountContact.findMany.mockResolvedValue([]);
    const r = await searchLeads({ limit: 5 });
    expect(r).toEqual({ items: [], nextCursor: null });
    expect(db.activity.groupBy).not.toHaveBeenCalled();
  });

  it("matches names and companies literally (LIKE wildcards are escaped)", async () => {
    db.accountContact.findMany.mockResolvedValue([]);
    await searchLeads({ limit: 5, q: "50%_off" });
    const or = db.accountContact.findMany.mock.calls[0][0].where.AND.find((c: any) => c.OR).OR;
    expect(or[0]).toEqual({ name: { contains: "50\\%\\_off", mode: "insensitive" } });
    expect(or[1]).toEqual({ account: { name: { contains: "50\\%\\_off", mode: "insensitive" } } });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("matches a phone by its last digits, and a name search that looks like a number too", async () => {
    db.$queryRaw.mockResolvedValue([{ id: C1 }]);
    db.accountContact.findMany.mockResolvedValue([]);
    await searchLeads({ limit: 5, phone: "+91 98765-43210" });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    // The 10-digit comparison binds only the last ten digits.
    expect(db.$queryRaw.mock.calls[0].slice(1)).toEqual(["9876543210"]);
    expect(db.accountContact.findMany.mock.calls[0][0].where.AND).toContainEqual({ id: { in: [C1] } });

    db.$queryRaw.mockClear();
    await searchLeads({ limit: 5, q: "543210" });
    expect(db.$queryRaw.mock.calls[0].slice(1)).toEqual(["%543210"]);
  });

  it("ignores phone fragments of fewer than four digits", async () => {
    db.accountContact.findMany.mockResolvedValue([]);
    await searchLeads({ limit: 5, phone: "98" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.accountContact.findMany.mock.calls[0][0].where.AND).toContainEqual({ id: { in: [] } });
  });

  it("filters by stage, rep and source (name or id)", async () => {
    db.accountContact.findMany.mockResolvedValue([]);
    await searchLeads({ limit: 5, stageId: C1, ownerId: C2, source: "Meta Ads" });
    await searchLeads({ limit: 5, source: C3 });
    const and1 = db.accountContact.findMany.mock.calls[0][0].where.AND;
    expect(and1).toContainEqual({ leadStageId: C1 });
    expect(and1).toContainEqual({ account: { ownerUserId: C2 } });
    expect(and1).toContainEqual({ leadSource: { name: { equals: "Meta Ads", mode: "insensitive" } } });
    expect(db.accountContact.findMany.mock.calls[1][0].where.AND).toContainEqual({ leadSourceId: C3 });
  });

  it("returns no phone number and no email", async () => {
    db.accountContact.findMany.mockResolvedValue([leadRow(C1, { email: "x@y.z" })]);
    db.activity.groupBy.mockResolvedValue([]);
    const json = JSON.stringify(await searchLeads({ limit: 5 }));
    expect(json).not.toMatch(/9876543210|x@y\.z|email|"phone"/);
    expect(json).toContain("3210");
  });
});

describe("getLead", () => {
  const contact = {
    id: C1,
    name: "Asha",
    phone: "9876543210",
    email: null,
    designation: null,
    notes: null,
    fields: "{}",
    pipelineStage: "LEAD",
    promotedToLeadAt: D,
    createdAt: D,
    leadStage: { id: "s1", name: "New" },
    leadSource: null,
    account: { id: "a1", name: "Co", city: "Pune", businessType: null, customerProfile: null, owner: null },
  };

  function arrange() {
    db.accountContact.findFirst.mockResolvedValue(contact);
    db.deal.findMany.mockResolvedValue([]);
    for (const t of [db.accountContactNote, db.contactNextAction, db.reminder, db.contactProductInterest, db.quotation, db.courtImage, db.activity]) {
      t.findMany.mockResolvedValue([]);
    }
    db.activity.aggregate.mockResolvedValue({ _max: { occurredAt: null } });
  }

  it("404s on a malformed id without querying", async () => {
    await expect(getLead("nope")).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(db.accountContact.findFirst).not.toHaveBeenCalled();
  });

  it("404s when the contact is gone or its company is deleted", async () => {
    db.accountContact.findFirst.mockResolvedValue(null);
    await expect(getLead(C1)).rejects.toBeInstanceOf(AgentHttpError);
    expect(db.accountContact.findFirst.mock.calls[0][0].where).toEqual({ id: C1, deletedAt: null, account: { deletedAt: null } });
  });

  it("never reads insights or attachments, and never selects storage URLs or cost", async () => {
    arrange();
    const out = await getLead(C1);
    expect(out.id).toBe(C1);
    // Proxy would have thrown on contactInsight / accountContactAttachment / user / setting.
    const everyQuery = JSON.stringify(
      Object.values(db).flatMap((t) => (typeof t === "object" ? Object.values(t).flatMap((fn: any) => fn.mock.calls) : [])),
    );
    expect(everyQuery).not.toMatch(/insight|attachment|fileUrl|pdfUrl|imageUrl|totalCostInr|passwordHash|gstin/i);
    // Notes exclude soft-deleted ones.
    expect(db.accountContactNote.findMany.mock.calls[0][0].where).toEqual({ accountContactId: C1, deletedAt: null });
    // Only open work is listed.
    expect(db.contactNextAction.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null, doneAt: null });
    expect(db.reminder.findMany.mock.calls[0][0].where).toMatchObject({ completedAt: null });
  });

  it("bounds every sub-list", async () => {
    arrange();
    await getLead(C1);
    for (const t of [db.accountContactNote, db.contactNextAction, db.reminder, db.contactProductInterest, db.quotation, db.courtImage, db.activity]) {
      const take = t.findMany.mock.calls[0][0].take;
      expect(take, "every sub-list has a take").toBeGreaterThan(0);
      expect(take).toBeLessThanOrEqual(20);
    }
    expect(db.deal.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(20);
  });
});

describe("getLeadTimeline", () => {
  const entry = (n: number, over: Record<string, unknown> = {}) => ({
    id: `e${n}`,
    kind: "activity",
    title: `Event ${n}`,
    detail: null,
    timestamp: new Date(2026, 8, 30 - n).toISOString(),
    ownerName: "Priya",
    ...over,
  });

  it("reads as a viewer who can see no rep's insights, drops private kinds, and pages", async () => {
    db.accountContact.findFirst.mockResolvedValue({ id: C1 });
    getContactTimeline.mockResolvedValue([
      entry(1),
      entry(2, { kind: "insight", title: "Insight added — PRIVATE" }),
      entry(3),
      entry(4, { kind: "file", title: "File uploaded — id.pdf" }),
      entry(5),
      entry(6),
    ]);
    const p1 = await getLeadTimeline(C1, { limit: 2 });
    expect(getContactTimeline).toHaveBeenCalledWith(C1, { id: "__agent__", role: "ai_agent" });
    expect(p1.items.map((i) => i.id)).toEqual(["e1", "e3"]);
    expect(p1.nextCursor).toBe("2");
    const p2 = await getLeadTimeline(C1, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.id)).toEqual(["e5", "e6"]);
    expect(p2.nextCursor).toBeNull();
    expect(JSON.stringify([p1, p2])).not.toContain("PRIVATE");
    expect(db.accountContact.findFirst).toHaveBeenCalledWith({ where: { id: C1, deletedAt: null, account: { deletedAt: null } }, select: { id: true } });
  });

  it("404s for a deleted contact before reading its timeline", async () => {
    db.accountContact.findFirst.mockResolvedValue(null);
    await expect(getLeadTimeline(C1, { limit: 5 })).rejects.toMatchObject({ code: "not_found" });
    expect(getContactTimeline).not.toHaveBeenCalled();
  });
});

describe("checkDuplicates", () => {
  const phoneContact = {
    id: C1, name: "Asha Rao", phone: "9876543210", accountId: "a1", pipelineStage: "LEAD",
    leadStage: { name: "Quoted" }, account: { name: "Rao Sports" },
  };

  beforeEach(() => {
    contactsMatchingPhone.mockResolvedValue([]);
    findAccountDuplicate.mockResolvedValue(null);
    findAccountContactDuplicate.mockResolvedValue(null);
    db.contact.findUnique.mockResolvedValue(null);
    db.metaLead.findMany.mockResolvedValue([]);
    db.accountContact.findMany.mockResolvedValue([]);
  });

  it("finds a CRM lead by phone, a WhatsApp contact and ad leads, with their types", async () => {
    contactsMatchingPhone.mockResolvedValue([{ id: C1, phone: "9876543210" }]);
    db.accountContact.findMany.mockResolvedValue([phoneContact, { ...phoneContact, id: C2, pipelineStage: null, leadStage: null }]);
    db.contact.findUnique.mockResolvedValue({ id: "w1", name: "Asha WA", phone: "919876543210" });
    db.metaLead.findMany.mockResolvedValue([{ id: "m1", fullName: "Asha", phone: "9876543210", campaignName: "Camp A", stage: "NEW" }]);
    const r = await checkDuplicates({ phone: "98765 43210" });
    expect(r.hasDuplicates).toBe(true);
    expect(r.matches.map((m) => [m.type, m.id])).toEqual([
      ["crm_lead", C1],
      ["crm_contact", C2],
      ["whatsapp_contact", "w1"],
      ["ad_lead", "m1"],
    ]);
    expect(r.matches[0]).toMatchObject({ matchedOn: "phone", confidence: "high", detail: "Quoted", company: "Rao Sports", phoneLast4: "3210" });
    expect(r.matches[3].detail).toBe("Camp A · NEW");
    // Looked up by the normalised phone.
    expect(db.contact.findUnique).toHaveBeenCalledWith({ where: { phone: "919876543210" }, select: { id: true, name: true, phone: true } });
    expect(db.metaLead.findMany.mock.calls[0][0].where).toEqual({ normalizedPhone: "919876543210" });
    expect(JSON.stringify(r)).not.toContain("9876543210");
  });

  it("reports a company match and a same-named contact inside it, and builds the phone index itself", async () => {
    findAccountDuplicate.mockResolvedValue({ id: "a1", name: "Rao Sports", city: "Pune" });
    findAccountContactDuplicate.mockResolvedValue({ id: C2, name: "Asha Rao", phone: null, accountId: "a1" });
    db.accountContact.findFirst.mockResolvedValue({ id: C2, name: "Asha Rao", phone: null, pipelineStage: null, leadStage: null, account: { name: "Rao Sports" } });
    const r = await checkDuplicates({ name: "Asha Rao", company: "Rao Sports", city: "Pune" });
    expect(findAccountDuplicate).toHaveBeenCalledWith({ name: "Rao Sports", city: "Pune" });
    expect(findAccountContactDuplicate).toHaveBeenCalledWith({ phone: undefined, name: "Asha Rao", accountId: "a1" }, expect.any(Map));
    expect(r.matches.map((m) => [m.type, m.matchedOn, m.confidence])).toEqual([
      ["company", "company_name", "high"],
      ["crm_contact", "name_in_company", "high"],
    ]);
  });

  it("treats a company match without a city as low confidence", async () => {
    findAccountDuplicate.mockResolvedValue({ id: "a1", name: "Rao Sports", city: null });
    const r = await checkDuplicates({ company: "Rao Sports" });
    expect(r.matches[0]).toMatchObject({ type: "company", confidence: "low" });
  });

  it("falls back to weak, exact name matches only when nothing else was given", async () => {
    db.accountContact.findMany.mockResolvedValue([phoneContact]);
    const r = await checkDuplicates({ name: "Asha Rao" });
    expect(db.accountContact.findMany.mock.calls[0][0]).toMatchObject({
      where: { name: { equals: "Asha Rao", mode: "insensitive" } },
      take: 5,
    });
    expect(r.matches[0]).toMatchObject({ matchedOn: "name_only", confidence: "low" });
  });

  it("reports no duplicates when nothing matches", async () => {
    expect(await checkDuplicates({ phone: "9876543210" })).toEqual({ hasDuplicates: false, matches: [] });
  });

  it("rejects a phone that is not a phone number", async () => {
    await expect(checkDuplicates({ phone: "call me" })).rejects.toMatchObject({ code: "invalid_input", status: 400 });
    expect(db.contact.findUnique).not.toHaveBeenCalled();
  });

  it("never writes: only read methods are ever called", async () => {
    contactsMatchingPhone.mockResolvedValue([{ id: C1, phone: "9876543210" }]);
    db.accountContact.findMany.mockResolvedValue([phoneContact]);
    await checkDuplicates({ phone: "9876543210", name: "Asha", company: "Rao" });
    for (const table of Object.values(db)) {
      if (typeof table !== "object") continue;
      for (const method of Object.keys(table)) expect(method).not.toMatch(/^(create|update|upsert|delete)/);
    }
  });
});
