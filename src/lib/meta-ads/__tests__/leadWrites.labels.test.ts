import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  leadSource: { findFirst: vi.fn() },
  metaLead: { findUnique: vi.fn(), updateMany: vi.fn() },
  metaLeadToLabel: { findMany: vi.fn() },
  account: { create: vi.fn() },
  accountContact: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  accountContactToLabel: { createMany: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const crm = vi.hoisted(() => ({ findAccountContactDuplicate: vi.fn(), firstLeadStage: vi.fn() }));
vi.mock("@/lib/crm/accounts", () => ({ findAccountContactDuplicate: crm.findAccountContactDuplicate }));
vi.mock("@/lib/crm/leadStages", () => ({ firstLeadStage: crm.firstLeadStage }));

import { moveMetaLeadToCrm } from "../leadWrites";

const lead = {
  id: "m1",
  fullName: "Asha",
  phone: "+919876543210",
  email: null,
  city: "Pune",
  normalizedPhone: "919876543210",
  accountContactId: null,
};
const move = () => moveMetaLeadToCrm({ metaLeadId: "m1", actorUserId: "u1", ownerUserId: null });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.leadSource.findFirst.mockResolvedValue({ id: "src" });
  db.metaLead.findUnique.mockResolvedValue(lead);
  db.metaLead.updateMany.mockResolvedValue({ count: 1 });
  db.metaLeadToLabel.findMany.mockResolvedValue([{ labelId: "L1" }, { labelId: "L2" }]);
  db.account.create.mockResolvedValue({ id: "a1" });
  db.accountContact.create.mockResolvedValue({ id: "c-new" });
  db.accountContact.findUnique.mockResolvedValue({ pipelineStage: "LEAD", leadSourceId: "src", leadStageId: null });
  db.accountContact.findFirst.mockResolvedValue({ id: "any" });
  crm.findAccountContactDuplicate.mockResolvedValue(null);
  crm.firstLeadStage.mockResolvedValue(null);
});

const copiedTo = (id: string) => ({
  data: [
    { accountContactId: id, labelId: "L1" },
    { accountContactId: id, labelId: "L2" },
  ],
  skipDuplicates: true,
});

describe("Move to CRM copies the ad lead's labels onto the contact", () => {
  it("onto a newly created contact, in the same transaction", async () => {
    const r = await move();
    expect(r).toMatchObject({ kind: "ok", accountContactId: "c-new", matchedExisting: false });
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith(copiedTo("c-new"));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("onto an existing contact matched by phone, keeping the labels it already has", async () => {
    crm.findAccountContactDuplicate.mockResolvedValue({ id: "c-old", name: "Asha", phone: "+919876543210", accountId: "a0" });
    const r = await move();
    expect(r).toMatchObject({ kind: "ok", accountContactId: "c-old", matchedExisting: true });
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith(copiedTo("c-old"));
    expect(db.accountContactToLabel.deleteMany).not.toHaveBeenCalled();
  });

  it("copies nothing again for a lead that is already linked (one-time copy)", async () => {
    db.metaLead.findUnique.mockResolvedValue({ ...lead, accountContactId: "c-old" });
    expect(await move()).toEqual({ kind: "already_linked", accountContactId: "c-old" });
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("copies nothing when a concurrent request already linked the lead", async () => {
    db.metaLead.updateMany.mockResolvedValue({ count: 0 });
    db.metaLead.findUnique.mockResolvedValueOnce(lead).mockResolvedValueOnce({ accountContactId: "c-win" });
    expect(await move()).toEqual({ kind: "already_linked", accountContactId: "c-win" });
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });

  it("a lead without labels leaves the contact's labels alone", async () => {
    db.metaLeadToLabel.findMany.mockResolvedValue([]);
    expect((await move()).kind).toBe("ok");
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });
});
