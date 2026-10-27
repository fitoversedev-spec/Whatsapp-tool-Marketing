import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  accountContact: { findFirst: vi.fn(), findMany: vi.fn() },
  accountContactToLabel: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  metaLeadLabel: { findMany: vi.fn(), findUnique: vi.fn() },
  metaLeadToLabel: { findMany: vi.fn() },
  websiteLeadToLabel: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  bulkChangeContactLabel,
  copyLeadLabelsToContact,
  mergeContactLabels,
  setContactLabels,
} from "../contactLabels";

const rep = { id: "rep1", role: "sales" };
const otherRep = "rep2";
const admin = { id: "admin1", role: "admin" };
const manager = { id: "mgr1", role: "manager" };
const management = { id: "mgmt1", role: "management" };

const hot = { id: "11111111-1111-4111-8111-111111111111", name: "Hot", color: "red" };
const cold = { id: "22222222-2222-4222-8222-222222222222", name: "Cold", color: "blue" };
const ac = (ownerUserId: string | null) => ({ id: "c1", account: { ownerUserId } });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.accountContact.findFirst.mockResolvedValue(ac(rep.id));
  db.accountContact.findMany.mockResolvedValue([]);
  db.accountContactToLabel.findMany.mockResolvedValue([]);
  db.metaLeadLabel.findMany.mockResolvedValue([]);
  db.metaLeadLabel.findUnique.mockResolvedValue({ id: hot.id });
  db.metaLeadToLabel.findMany.mockResolvedValue([]);
  db.websiteLeadToLabel.findMany.mockResolvedValue([]);
});

describe("setContactLabels", () => {
  it("never touches a missing or soft-deleted contact", async () => {
    db.accountContact.findFirst.mockResolvedValue(null);
    expect(await setContactLabels(rep, "c1", [hot.id])).toEqual({ kind: "not_found" });
    expect(db.accountContact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", deletedAt: null } }),
    );
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });

  it("a rep can't change labels on someone else's customer", async () => {
    db.accountContact.findFirst.mockResolvedValue(ac(otherRep));
    expect(await setContactLabels(rep, "c1", [hot.id])).toEqual({ kind: "forbidden" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("allows the owner, an unowned contact, and admins/managers anywhere", async () => {
    db.metaLeadLabel.findMany.mockResolvedValue([hot]);
    for (const [user, owner] of [
      [rep, rep.id],
      [rep, null],
      [admin, otherRep],
      [manager, otherRep],
    ] as const) {
      db.accountContact.findFirst.mockResolvedValue(ac(owner));
      expect((await setContactLabels(user, "c1", [hot.id])).kind).toBe("ok");
    }
  });

  it("read-only management can see all customers but not change labels", async () => {
    db.accountContact.findFirst.mockResolvedValue(ac(otherRep));
    expect(await setContactLabels(management, "c1", [hot.id])).toEqual({ kind: "forbidden" });
  });

  it("refuses an unknown label and writes nothing", async () => {
    db.metaLeadLabel.findMany.mockResolvedValue([hot]);
    expect(await setContactLabels(rep, "c1", [hot.id, cold.id])).toEqual({ kind: "invalid_label" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("replaces the applied set (duplicates removed) and returns the labels sorted by name", async () => {
    db.metaLeadLabel.findMany.mockResolvedValue([hot, cold]);
    const r = await setContactLabels(rep, "c1", [hot.id, cold.id, hot.id]);
    expect(r).toEqual({ kind: "ok", labels: [cold, hot] });
    expect(db.metaLeadLabel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [hot.id, cold.id] } } }),
    );
    expect(db.accountContactToLabel.deleteMany).toHaveBeenCalledWith({
      where: { accountContactId: "c1", labelId: { notIn: [hot.id, cold.id] } },
    });
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith({
      data: [
        { accountContactId: "c1", labelId: hot.id },
        { accountContactId: "c1", labelId: cold.id },
      ],
      skipDuplicates: true,
    });
  });

  it("an empty set clears every label without looking anything up", async () => {
    expect(await setContactLabels(rep, "c1", [])).toEqual({ kind: "ok", labels: [] });
    expect(db.metaLeadLabel.findMany).not.toHaveBeenCalled();
    expect(db.accountContactToLabel.deleteMany).toHaveBeenCalledWith({ where: { accountContactId: "c1" } });
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });
});

describe("bulkChangeContactLabel", () => {
  // a: rep's own, b: someone else's, c: unowned, d: unknown/deleted (not returned by the live-only query)
  const rows = [
    { id: "a", account: { ownerUserId: rep.id } },
    { id: "b", account: { ownerUserId: otherRep } },
    { id: "c", account: { ownerUserId: null } },
  ];

  it("refuses an unknown label before touching any contact", async () => {
    db.metaLeadLabel.findUnique.mockResolvedValue(null);
    expect(await bulkChangeContactLabel(rep, { ids: ["a"], labelId: hot.id, action: "add" })).toEqual({
      kind: "invalid_label",
    });
    expect(db.accountContact.findMany).not.toHaveBeenCalled();
  });

  it("add: only live contacts the user can edit get the label; the rest are skipped", async () => {
    db.accountContact.findMany.mockResolvedValue(rows);
    const r = await bulkChangeContactLabel(rep, { ids: ["a", "b", "c", "d", "a"], labelId: hot.id, action: "add" });
    expect(r).toEqual({ kind: "ok", changed: 2, skipped: 2 });
    expect(db.accountContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["a", "b", "c", "d"] }, deletedAt: null } }),
    );
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith({
      data: [
        { accountContactId: "a", labelId: hot.id },
        { accountContactId: "c", labelId: hot.id },
      ],
      skipDuplicates: true,
    });
    expect(db.accountContactToLabel.deleteMany).not.toHaveBeenCalled();
  });

  it("remove: takes the label off only the contacts the user can edit", async () => {
    db.accountContact.findMany.mockResolvedValue(rows);
    const r = await bulkChangeContactLabel(rep, { ids: ["a", "b", "c"], labelId: hot.id, action: "remove" });
    expect(r).toEqual({ kind: "ok", changed: 2, skipped: 1 });
    expect(db.accountContactToLabel.deleteMany).toHaveBeenCalledWith({
      where: { accountContactId: { in: ["a", "c"] }, labelId: hot.id },
    });
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });

  it("an admin reaches everyone's contacts", async () => {
    db.accountContact.findMany.mockResolvedValue(rows);
    expect(await bulkChangeContactLabel(admin, { ids: ["a", "b", "c"], labelId: hot.id, action: "add" })).toEqual({
      kind: "ok",
      changed: 3,
      skipped: 0,
    });
  });

  it("writes nothing when no contact is allowed", async () => {
    db.accountContact.findMany.mockResolvedValue([rows[1]]);
    expect(await bulkChangeContactLabel(rep, { ids: ["b", "zzz"], labelId: hot.id, action: "add" })).toEqual({
      kind: "ok",
      changed: 0,
      skipped: 2,
    });
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
    expect(db.accountContactToLabel.deleteMany).not.toHaveBeenCalled();
  });
});

describe("copyLeadLabelsToContact (Move to CRM)", () => {
  it("copies an ad lead's labels onto the contact as a union", async () => {
    db.metaLeadToLabel.findMany.mockResolvedValue([{ labelId: hot.id }, { labelId: cold.id }]);
    await copyLeadLabelsToContact(db as never, { metaLeadId: "m1" }, "c1");
    expect(db.metaLeadToLabel.findMany).toHaveBeenCalledWith({ where: { metaLeadId: "m1" }, select: { labelId: true } });
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith({
      data: [
        { accountContactId: "c1", labelId: hot.id },
        { accountContactId: "c1", labelId: cold.id },
      ],
      skipDuplicates: true,
    });
    // union only: the contact's own labels are never removed
    expect(db.accountContactToLabel.deleteMany).not.toHaveBeenCalled();
  });

  it("copies a website lead's labels", async () => {
    db.websiteLeadToLabel.findMany.mockResolvedValue([{ labelId: hot.id }]);
    await copyLeadLabelsToContact(db as never, { websiteLeadId: "w1" }, "c1");
    expect(db.websiteLeadToLabel.findMany).toHaveBeenCalledWith({ where: { websiteLeadId: "w1" }, select: { labelId: true } });
    expect(db.metaLeadToLabel.findMany).not.toHaveBeenCalled();
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith({
      data: [{ accountContactId: "c1", labelId: hot.id }],
      skipDuplicates: true,
    });
  });

  it("does nothing for a lead without labels", async () => {
    await copyLeadLabelsToContact(db as never, { metaLeadId: "m1" }, "c1");
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });

  it("never writes onto a soft-deleted contact", async () => {
    db.metaLeadToLabel.findMany.mockResolvedValue([{ labelId: hot.id }]);
    db.accountContact.findFirst.mockResolvedValue(null);
    await copyLeadLabelsToContact(db as never, { metaLeadId: "m1" }, "c1");
    expect(db.accountContact.findFirst).toHaveBeenCalledWith({ where: { id: "c1", deletedAt: null }, select: { id: true } });
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });
});

describe("mergeContactLabels", () => {
  it("unions the merged-away contacts' labels onto the survivor, each label once", async () => {
    db.accountContactToLabel.findMany.mockResolvedValue([
      { labelId: hot.id },
      { labelId: cold.id },
      { labelId: hot.id }, // both secondaries carried "Hot"
    ]);
    await mergeContactLabels(db as never, ["s1", "s2"], "p1");
    expect(db.accountContactToLabel.findMany).toHaveBeenCalledWith({
      where: { accountContactId: { in: ["s1", "s2"] } },
      select: { labelId: true },
    });
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith({
      data: [
        { accountContactId: "p1", labelId: hot.id },
        { accountContactId: "p1", labelId: cold.id },
      ],
      skipDuplicates: true,
    });
    expect(db.accountContactToLabel.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when the merged-away contacts had no labels", async () => {
    await mergeContactLabels(db as never, ["s1"], "p1");
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });
});
