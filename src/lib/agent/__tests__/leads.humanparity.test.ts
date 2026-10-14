import { beforeEach, describe, expect, it, vi } from "vitest";

// The logic extracted from the human routes must behave exactly as it did inline.
// These pin the human-facing outputs (Timeline wording, error, rows written).
const db = vi.hoisted(() => ({
  leadStage: { findUnique: vi.fn(), findFirst: vi.fn() },
  accountContact: { update: vi.fn(), updateMany: vi.fn() },
  account: { update: vi.fn() },
  contactEvent: { createMany: vi.fn() },
  contactNextAction: { update: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { applyContactPatch, ContactPatchError, type PatchableContact } from "@/lib/crm/contactPatch";
import { updateNextAction } from "@/lib/crm/nextActions";

const before = (over: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    accountId: "a1",
    name: "Ravi",
    phone: "9198",
    email: null,
    designation: null,
    notes: null,
    fields: JSON.stringify({ Floor: "wood" }),
    isPrimary: false,
    pipelineStage: null,
    promotedToLeadAt: null,
    leadStageId: null,
    leadSourceId: null,
    leadStage: null,
    account: { id: "a1", name: "Ravi", city: null, ownerUserId: null, customerProfileId: null, businessType: null },
    ...over,
  }) as unknown as PatchableContact;

const events = () => (db.contactEvent.createMany.mock.calls[0]?.[0].data ?? []) as { kind: string; summary: string; detail: string | null; actorUserId: string }[];

beforeEach(() => {
  for (const group of [db.leadStage, db.accountContact, db.account, db.contactEvent, db.contactNextAction]) {
    for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  db.$transaction.mockReset();
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => unknown) => cb(db));
  db.accountContact.update.mockResolvedValue({ id: "c1" });
  db.contactEvent.createMany.mockResolvedValue({ count: 1 });
  db.leadStage.findFirst.mockResolvedValue({ id: "s1", name: "Lead Generation" });
});

describe("applyContactPatch (PATCH /api/account-contacts/[id])", () => {
  it("a details edit writes one 'Details edited' entry with old -> new lines", async () => {
    await applyContactPatch({ before: before(), input: { name: "Ravi K", email: "r@x.com" }, actorUserId: "rep" });
    expect(db.accountContact.update.mock.calls[0][0]).toEqual({ where: { id: "c1" }, data: { name: "Ravi K", email: "r@x.com" } });
    expect(events()).toEqual([
      expect.objectContaining({ kind: "details_edited", summary: "Details edited", detail: "Name: Ravi → Ravi K\nEmail: — → r@x.com", actorUserId: "rep" }),
    ]);
  });

  it("custom fields are replaced as sent (the human behaviour)", async () => {
    await applyContactPatch({ before: before(), input: { fields: { Roof: "yes" } }, actorUserId: "rep" });
    expect(db.accountContact.update.mock.calls[0][0].data.fields).toBe(JSON.stringify({ Roof: "yes" }));
    expect(events()[0].detail).toBe("Floor: wood → —\nRoof: — → yes");
  });

  it("an inactive or removed stage is refused with 'Stage not available' (422) before anything is written", async () => {
    db.leadStage.findUnique.mockResolvedValue({ id: "s2", name: "Old", isActive: false, deletedAt: null });
    const err = await applyContactPatch({ before: before(), input: { leadStageId: "s2" }, actorUserId: "rep" }).catch((e) => e);
    expect(err).toBeInstanceOf(ContactPatchError);
    expect(err).toMatchObject({ message: "Stage not available", status: 422 });
    expect(db.accountContact.update).not.toHaveBeenCalled();
  });

  it("a stage change logs 'Stage: A -> B'", async () => {
    db.leadStage.findUnique.mockResolvedValue({ id: "s2", name: "Qualified", isActive: true, deletedAt: null });
    await applyContactPatch({ before: before({ leadStageId: "s1", leadStage: { name: "Lead Generation" } }), input: { leadStageId: "s2" }, actorUserId: "rep" });
    expect(events().map((e) => e.summary)).toEqual(["Stage: Lead Generation → Qualified"]);
  });

  it("moving into Leads stamps the promotion, starts at the first stage, and logs both", async () => {
    await applyContactPatch({ before: before(), input: { pipelineStage: "LEAD" }, actorUserId: "rep" });
    const data = db.accountContact.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ pipelineStage: "LEAD", leadStageId: "s1" });
    expect(data.promotedToLeadAt).toBeInstanceOf(Date);
    expect(events().map((e) => e.summary)).toEqual(["Moved to Leads", "Stage: No stage → Lead Generation"]);
  });

  it("removing from Leads logs 'Removed from Leads'; an already-promoted date is kept", async () => {
    await applyContactPatch({ before: before({ pipelineStage: "LEAD" }), input: { pipelineStage: null }, actorUserId: "rep" });
    expect(events().map((e) => e.summary)).toEqual(["Removed from Leads"]);
    db.accountContact.update.mockClear();
    await applyContactPatch({ before: before({ pipelineStage: null, promotedToLeadAt: new Date() }), input: { pipelineStage: "LEAD" }, actorUserId: "rep" });
    expect(db.accountContact.update.mock.calls[0][0].data).not.toHaveProperty("promotedToLeadAt");
  });

  it("company fields go to the Account in the same transaction", async () => {
    await applyContactPatch({ before: before(), input: { siteCity: "Pune", businessType: "B2B" }, actorUserId: "rep" });
    expect(db.account.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { city: "Pune", businessType: "B2B" } });
  });

  it("only the AI's options change the wording; without them it is the human text", async () => {
    await applyContactPatch({ before: before(), input: { name: "X" }, actorUserId: "ai", options: { detailsSummary: "Details edited by AI Sales Agent" } });
    expect(events()[0].summary).toBe("Details edited by AI Sales Agent");
  });
});

describe("updateNextAction (PATCH .../next-actions/[actionId])", () => {
  const action = (over: Record<string, unknown> = {}) =>
    ({ id: "n1", accountContactId: "c1", text: "Call", dueAt: null, doneAt: null, createdByUserId: "rep", reminderId: null, deletedAt: null, ...over }) as never;

  // syncNextActionReminder reads the action back; with nothing found it returns quietly.
  beforeEach(() => db.contactNextAction.findUnique.mockResolvedValue(null));

  it("returns the action untouched when nothing changed", async () => {
    const a = action();
    const out = await updateNextAction({ before: a, patch: { text: "Call", done: false }, actorUserId: "rep" });
    expect(out).toBe(a);
    expect(db.contactNextAction.update).not.toHaveBeenCalled();
    expect(db.contactEvent.createMany).not.toHaveBeenCalled();
  });

  it("ticking done sets who and when, and logs 'Next action done'", async () => {
    db.contactNextAction.update.mockResolvedValue({ id: "n1" });
    await updateNextAction({ before: action(), patch: { done: true }, actorUserId: "rep" });
    const data = db.contactNextAction.update.mock.calls[0][0].data;
    expect(data.doneByUserId).toBe("rep");
    expect(data.doneAt).toBeInstanceOf(Date);
    expect(events().map((e) => `${e.kind}|${e.summary}`)).toEqual(["next_action_done|Next action done — Call"]);
  });

  it("an edit logs the old -> new text", async () => {
    db.contactNextAction.update.mockResolvedValue({ id: "n1" });
    await updateNextAction({ before: action(), patch: { text: "Visit site" }, actorUserId: "rep" });
    expect(events()).toEqual([
      expect.objectContaining({ kind: "next_action_edited", summary: "Next action edited — Visit site", detail: "Action: Call → Visit site" }),
    ]);
  });
});
