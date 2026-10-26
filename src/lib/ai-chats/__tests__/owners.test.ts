import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversation: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  contact: { findFirst: vi.fn() },
  accountContact: { findFirst: vi.fn(), findUnique: vi.fn() },
  metaLead: { findFirst: vi.fn() },
  user: { findFirst: vi.fn(), findUnique: vi.fn() },
  aiHumanHandoff: { findFirst: vi.fn(), create: vi.fn() },
  agentIdentity: { findFirst: vi.fn() },
  aiHotLead: { updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn(async () => undefined) }));
const reassign = vi.hoisted(() => vi.fn());
vi.mock("@/lib/crm/assignRep", () => ({ reassignCustomerRep: (...a: unknown[]) => reassign(...a) }));
vi.mock("@/lib/crm/contactEvents", () => ({ logContactEvent: vi.fn() }));
const introduce = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent/handoffs/assign", () => ({ introduceSalesperson: (...a: unknown[]) => introduce(...a) }));

import { adoptExistingOwner, findExistingOwner, phoneVariants } from "../owners";

const active = (id: string, name: string) => ({ id, name });

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findFirst.mockResolvedValue(null);
  db.contact.findFirst.mockResolvedValue(null);
  db.accountContact.findFirst.mockResolvedValue(null);
  db.metaLead.findFirst.mockResolvedValue(null);
  db.user.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
    ({ priya: active("priya", "Priya"), arun: active("arun", "Arun") })[where.id] ?? null,
  );
});

describe("phoneVariants", () => {
  it("covers every stored spelling", () => {
    expect(phoneVariants("+91 98111 22233")).toEqual(["+91 98111 22233", "919811122233", "+919811122233"]);
    expect(phoneVariants("9811122233")).toEqual(["9811122233", "919811122233", "+919811122233"]);
  });
});

describe("findExistingOwner", () => {
  it("finds the salesperson assigned on Meta leads", async () => {
    db.metaLead.findFirst.mockResolvedValue({ assignedToUserId: "priya", accountContactId: null });
    expect(await findExistingOwner("919811122233")).toEqual({ userId: "priya", name: "Priya", source: "ad_lead", leadId: null });
  });

  it("prefers the Inbox assignee, then the CRM rep, over Meta leads", async () => {
    db.metaLead.findFirst.mockResolvedValue({ assignedToUserId: "arun", accountContactId: null });
    db.accountContact.findFirst.mockResolvedValue({ id: "lead1", account: { ownerUserId: "priya" } });
    expect(await findExistingOwner("919811122233")).toMatchObject({ userId: "priya", source: "crm", leadId: "lead1" });
    db.conversation.findFirst.mockResolvedValue({ assignedToUserId: "arun" });
    expect(await findExistingOwner("919811122233")).toMatchObject({ userId: "arun", source: "chat" });
  });

  it("skips people who left and returns null when nobody owns the number", async () => {
    db.metaLead.findFirst.mockResolvedValue({ assignedToUserId: "gone", accountContactId: null });
    expect(await findExistingOwner("919811122233")).toBeNull();
  });
});

describe("adoptExistingOwner", () => {
  beforeEach(() => {
    db.aiHumanHandoff.findFirst.mockResolvedValue(null);
    db.conversation.findUnique.mockResolvedValue({ id: "c1", contactPhone: "919811122233", contactName: "Karan", assignedToUserId: null });
    db.agentIdentity.findFirst.mockResolvedValue({ id: "ident" });
    db.user.findUnique.mockResolvedValue({ pushEnabled: false });
    db.aiHumanHandoff.create.mockResolvedValue({ id: "h1" });
    db.metaLead.findFirst.mockResolvedValue({ assignedToUserId: "priya", accountContactId: null });
  });

  it("links the chat to the existing salesperson and introduces them", async () => {
    expect(await adoptExistingOwner("c1")).toMatchObject({ userId: "priya" });
    expect(db.aiHumanHandoff.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "EXISTING_OWNER", status: "APPROVED", assignedToUserId: "priya" }) }),
    );
    expect(db.conversation.updateMany).toHaveBeenCalledWith({ where: { id: "c1", assignedToUserId: null }, data: { assignedToUserId: "priya" } });
    expect(introduce).toHaveBeenCalledWith("h1");
  });

  it("never replaces an existing CRM rep", async () => {
    db.metaLead.findFirst.mockResolvedValue({ assignedToUserId: "priya", accountContactId: "lead1" });
    db.accountContact.findUnique.mockResolvedValue({ accountId: "acc1" });
    await adoptExistingOwner("c1");
    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({ accountId: "acc1", onlyIfUnowned: true }));
  });

  it("does nothing for chats that already had a handoff, or nobody owns", async () => {
    db.aiHumanHandoff.findFirst.mockResolvedValue({ id: "old" });
    expect(await adoptExistingOwner("c1")).toBeNull();
    db.aiHumanHandoff.findFirst.mockResolvedValue(null);
    db.metaLead.findFirst.mockResolvedValue(null);
    expect(await adoptExistingOwner("c1")).toBeNull();
    expect(db.aiHumanHandoff.create).not.toHaveBeenCalled();
  });
});
