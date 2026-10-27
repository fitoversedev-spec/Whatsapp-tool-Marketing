import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  websiteLead: { updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  websiteLeadToLabel: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  accountContact: { findFirst: vi.fn() },
  accountContactToLabel: { createMany: vi.fn(), deleteMany: vi.fn() },
  metaLeadLabel: { findMany: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const lw = vi.hoisted(() => ({
  findActiveMetaLeadStage: vi.fn(),
  promoteLeadToCrm: vi.fn(),
  upsertMarketingContact: vi.fn(),
}));
vi.mock("@/lib/meta-ads/leadWrites", () => lw);

import {
  assignWebsiteLeads,
  moveWebsiteLeadToCrm,
  moveWebsiteLeadToMarketing,
  setWebsiteLeadLabels,
  updateWebsiteLead,
} from "../writes";

const rep = "2f1b6c7e-8a49-4d3c-9e51-0a7b6c5d4e3f";

beforeEach(() => {
  vi.clearAllMocks();
  lw.findActiveMetaLeadStage.mockResolvedValue({ slug: "QUALIFIED" });
  db.user.findFirst.mockResolvedValue({ id: rep, name: "Ravi" });
  db.websiteLead.updateMany.mockResolvedValue({ count: 1 });
  db.websiteLeadToLabel.findMany.mockResolvedValue([{ labelId: "L1" }, { labelId: "L2" }]);
  db.accountContact.findFirst.mockResolvedValue({ id: "any" });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe("updateWebsiteLead", () => {
  it("validates the stage against the shared pipeline before writing anything", async () => {
    lw.findActiveMetaLeadStage.mockResolvedValue(null);
    expect(await updateWebsiteLead("l1", { stage: "BOGUS", assignedToUserId: rep })).toBe("invalid_stage");
    expect(db.websiteLead.updateMany).not.toHaveBeenCalled();
  });

  it("a bad rep changes nothing, not even the stage", async () => {
    db.user.findFirst.mockResolvedValue(null);
    expect(await updateWebsiteLead("l1", { stage: "QUALIFIED", assignedToUserId: rep })).toBe("invalid_assignee");
    expect(db.websiteLead.updateMany).not.toHaveBeenCalled();
  });

  it("writes stage and rep together; null un-assigns", async () => {
    expect(await updateWebsiteLead("l1", { stage: "QUALIFIED", assignedToUserId: rep })).toBe("ok");
    expect(db.websiteLead.updateMany).toHaveBeenCalledWith({
      where: { id: "l1", deletedAt: null },
      data: { stage: "QUALIFIED", assignedToUserId: rep },
    });
    await updateWebsiteLead("l1", { assignedToUserId: null });
    expect(db.websiteLead.updateMany).toHaveBeenLastCalledWith({
      where: { id: "l1", deletedAt: null },
      data: { assignedToUserId: null },
    });
  });

  it("not_found when no live lead matched", async () => {
    db.websiteLead.updateMany.mockResolvedValue({ count: 0 });
    expect(await updateWebsiteLead("nope", { stage: "QUALIFIED" })).toBe("not_found");
  });
});

describe("assignWebsiteLeads (bulk)", () => {
  it("assigns and reports the rep and the count", async () => {
    db.websiteLead.updateMany.mockResolvedValue({ count: 3 });
    expect(await assignWebsiteLeads(["a", "b", "c"], rep)).toEqual({ kind: "ok", updated: 3, assignedToName: "Ravi" });
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: rep, deletedAt: null, isActive: true, approvalStatus: "approved" } }),
    );
  });

  it("refuses a rep who can't take leads", async () => {
    db.user.findFirst.mockResolvedValue(null);
    expect(await assignWebsiteLeads(["a"], rep)).toEqual({ kind: "invalid_assignee" });
    expect(db.websiteLead.updateMany).not.toHaveBeenCalled();
  });
});

describe("setWebsiteLeadLabels", () => {
  const l1 = "11111111-1111-4111-8111-111111111111";
  const l2 = "22222222-2222-4222-8222-222222222222";

  it("refuses an unknown label", async () => {
    db.websiteLead.findFirst.mockResolvedValue({ id: "l1" });
    db.metaLeadLabel.findMany.mockResolvedValue([{ id: l1, name: "Hot", color: "red" }]);
    expect(await setWebsiteLeadLabels("l1", [l1, l2])).toEqual({ kind: "invalid_label" });
    expect(db.websiteLeadToLabel.createMany).not.toHaveBeenCalled();
  });

  it("replaces the applied set from the shared label catalogue", async () => {
    db.websiteLead.findFirst.mockResolvedValue({ id: "l1" });
    db.metaLeadLabel.findMany.mockResolvedValue([{ id: l1, name: "Hot", color: "red" }]);
    const r = await setWebsiteLeadLabels("l1", [l1, l1]);
    expect(r).toEqual({ kind: "ok", labels: [{ id: l1, name: "Hot", color: "red" }] });
    expect(db.websiteLeadToLabel.deleteMany).toHaveBeenCalledWith({ where: { websiteLeadId: "l1", labelId: { notIn: [l1] } } });
    expect(db.websiteLeadToLabel.createMany).toHaveBeenCalledWith({
      data: [{ websiteLeadId: "l1", labelId: l1 }],
      skipDuplicates: true,
    });
  });
});

describe("moveWebsiteLeadToCrm", () => {
  const lead = { id: "l1", name: "Asha", phone: "+919876543210", normalizedPhone: "919876543210", email: null, city: "Pune", accountContactId: null };

  it("hands the shared promotion the 'website' lead source", async () => {
    db.websiteLead.findFirst.mockResolvedValue(lead);
    lw.promoteLeadToCrm.mockResolvedValue({ kind: "ok", accountContactId: "ac1", leadSourceId: "src", matchedExisting: false });
    const r = await moveWebsiteLeadToCrm({ websiteLeadId: "l1", actorUserId: "u1", ownerUserId: null });
    expect(r.kind).toBe("ok");
    expect(lw.promoteLeadToCrm).toHaveBeenCalledWith(expect.objectContaining({ leadSourceSlug: "website", actorUserId: "u1" }));
  });

  it("hands the shared promotion a label copy that adds the lead's labels to the contact (union only)", async () => {
    db.websiteLead.findFirst.mockResolvedValue(lead);
    lw.promoteLeadToCrm.mockResolvedValue({ kind: "ok", accountContactId: "ac1", leadSourceId: "src", matchedExisting: false });
    await moveWebsiteLeadToCrm({ websiteLeadId: "l1", actorUserId: "u1", ownerUserId: null });
    const { copyLabels } = lw.promoteLeadToCrm.mock.calls[0][0];
    await copyLabels(db, "ac1");
    expect(db.websiteLeadToLabel.findMany).toHaveBeenCalledWith({ where: { websiteLeadId: "l1" }, select: { labelId: true } });
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith({
      data: [
        { accountContactId: "ac1", labelId: "L1" },
        { accountContactId: "ac1", labelId: "L2" },
      ],
      skipDuplicates: true,
    });
    expect(db.accountContactToLabel.deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent once linked, and copies no labels again (one-time copy)", async () => {
    db.websiteLead.findFirst.mockResolvedValue({ ...lead, accountContactId: "ac9" });
    expect(await moveWebsiteLeadToCrm({ websiteLeadId: "l1", actorUserId: "u1", ownerUserId: null })).toEqual({
      kind: "already_linked",
      accountContactId: "ac9",
    });
    expect(lw.promoteLeadToCrm).not.toHaveBeenCalled();
    expect(db.accountContactToLabel.createMany).not.toHaveBeenCalled();
  });

  it("not_found for a missing lead", async () => {
    db.websiteLead.findFirst.mockResolvedValue(null);
    expect((await moveWebsiteLeadToCrm({ websiteLeadId: "x", actorUserId: "u1", ownerUserId: null })).kind).toBe("not_found");
  });
});

describe("moveWebsiteLeadToMarketing", () => {
  it("creates or reuses the WhatsApp contact and remembers it on the lead", async () => {
    db.websiteLead.findFirst.mockResolvedValue({ id: "l1", name: "Asha", phone: "+91 98765 43210", normalizedPhone: null, city: "Pune" });
    lw.upsertMarketingContact.mockResolvedValue({ created: true, contactId: "c1" });
    expect(await moveWebsiteLeadToMarketing("l1")).toEqual({ kind: "ok", created: true, contactId: "c1" });
    expect(lw.upsertMarketingContact).toHaveBeenCalledWith({ phone: "919876543210", name: "Asha", city: "Pune" });
    expect(db.websiteLead.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { contactId: "c1" } });
  });

  it("no usable phone", async () => {
    db.websiteLead.findFirst.mockResolvedValue({ id: "l1", name: "Asha", phone: "abc", normalizedPhone: null, city: null });
    expect(await moveWebsiteLeadToMarketing("l1")).toEqual({ kind: "no_phone" });
  });
});
