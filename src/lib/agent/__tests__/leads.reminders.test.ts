import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  contactNextAction: { findUnique: vi.fn(), update: vi.fn() },
  reminder: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  activityType: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { syncNextActionReminder } from "@/lib/crm/nextActions";

const DUE = new Date("2026-10-20T10:00:00Z");

function action(over: { createdByRole: string; accountOwner: string | null; reminder?: { ownerUserId: string } | null }) {
  return {
    id: "act-1",
    accountContactId: "c1",
    text: "Call back",
    dueAt: DUE,
    doneAt: null,
    deletedAt: null,
    createdByUserId: over.createdByRole === "ai_agent" ? "ai-user" : "rep-creator",
    createdBy: { role: over.createdByRole },
    accountContact: { account: { ownerUserId: over.accountOwner } },
    reminder: over.reminder ? { id: "rem-1", dueAt: DUE, completedAt: null, notifiedAt: null, ...over.reminder } : null,
  };
}

beforeEach(() => {
  for (const group of [db.contactNextAction, db.reminder, db.activityType]) {
    for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  db.activityType.findFirst.mockResolvedValue({ id: "type-task" });
  db.reminder.create.mockResolvedValue({ id: "rem-new" });
});

describe("syncNextActionReminder owner rules", () => {
  it("human-created action: the reminder follows the customer's rep, else the creator (unchanged)", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(action({ createdByRole: "sales", accountOwner: "rep-owner" }));
    await syncNextActionReminder("act-1");
    expect(db.reminder.create.mock.calls[0][0].data).toMatchObject({ ownerUserId: "rep-owner" });
    expect(db.reminder.create.mock.calls[0][0].data).not.toHaveProperty("priority");

    db.reminder.create.mockClear();
    db.contactNextAction.findUnique.mockResolvedValue(action({ createdByRole: "sales", accountOwner: null }));
    await syncNextActionReminder("act-1");
    expect(db.reminder.create.mock.calls[0][0].data.ownerUserId).toBe("rep-creator");
  });

  it("human-created action: options from a caller are not able to redirect it", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(action({ createdByRole: "sales", accountOwner: "rep-owner" }));
    await syncNextActionReminder("act-1", { ownerUserId: "someone-else" });
    expect(db.reminder.create.mock.calls[0][0].data.ownerUserId).toBe("rep-owner");
  });

  it("AI-created action: the reminder goes to the human it was addressed to, with priority", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(action({ createdByRole: "ai_agent", accountOwner: "rep-owner" }));
    await syncNextActionReminder("act-1", { ownerUserId: "engineer-1", priority: "HIGH" });
    expect(db.reminder.create.mock.calls[0][0].data).toMatchObject({ ownerUserId: "engineer-1", priority: "HIGH" });
  });

  it("AI-created action on an unowned customer is never left with the AI as the owner when a human is named", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(action({ createdByRole: "ai_agent", accountOwner: null }));
    await syncNextActionReminder("act-1", { ownerUserId: "admin-1" });
    expect(db.reminder.create.mock.calls[0][0].data.ownerUserId).toBe("admin-1");
  });

  it("AI-created action: a later sync keeps the reminder's owner instead of snapping back to the rep or the AI", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(
      action({ createdByRole: "ai_agent", accountOwner: null, reminder: { ownerUserId: "engineer-1" } }),
    );
    await syncNextActionReminder("act-1");
    expect(db.reminder.update.mock.calls[0][0].data.ownerUserId).toBe("engineer-1");
  });

  it("human-created action: a later sync still follows the rep", async () => {
    db.contactNextAction.findUnique.mockResolvedValue(
      action({ createdByRole: "sales", accountOwner: "rep-owner", reminder: { ownerUserId: "old-rep" } }),
    );
    await syncNextActionReminder("act-1");
    expect(db.reminder.update.mock.calls[0][0].data.ownerUserId).toBe("rep-owner");
  });
});
