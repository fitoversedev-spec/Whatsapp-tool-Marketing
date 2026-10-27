import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  // Every model mergeAccountContacts re-points is a bare updateMany here.
  const repointed = [
    "deal", "activity", "reminder", "quotation", "courtImage", "contactProductInterest",
    "accountContactNote", "accountContactAttachment", "contactNextAction", "contactInsight",
    "contactEvent", "handoffRequest", "coverageGrant",
  ];
  const models: Record<string, unknown> = {};
  for (const m of repointed) models[m] = { updateMany: vi.fn() };
  return {
    ...models,
    accountContact: { deleteMany: vi.fn() },
    accountContactToLabel: { findMany: vi.fn(), createMany: vi.fn() },
    contact: { findFirst: vi.fn(), update: vi.fn() },
    chatThread: { findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { mergeAccountContacts } from "../accounts";

const hot = "11111111-1111-4111-8111-111111111111";
const order: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.contact.findFirst.mockResolvedValue({ id: "wa" });
  db.chatThread.findFirst.mockResolvedValue({ id: "t" });
  db.accountContactToLabel.findMany.mockResolvedValue([{ labelId: hot }]);
  db.accountContactToLabel.createMany.mockImplementation(async () => void order.push("labels"));
  db.accountContact.deleteMany.mockImplementation(async () => void order.push("delete"));
});

describe("mergeAccountContacts", () => {
  it("unions the secondaries' labels onto the primary before deleting them", async () => {
    await mergeAccountContacts("p1", ["s1", "s2"]);
    expect(db.accountContactToLabel.createMany).toHaveBeenCalledWith({
      data: [{ accountContactId: "p1", labelId: hot }],
      skipDuplicates: true,
    });
    expect(db.accountContact.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s1", "s2"] } } });
    expect(order).toEqual(["labels", "delete"]);
  });
});
