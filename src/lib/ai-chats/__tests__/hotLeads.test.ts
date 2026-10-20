import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aiHotLead: { createMany: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/push", () => ({ sendPushToUser: (...a: unknown[]) => push(...a) }));
vi.mock("@/lib/crm/assignRep", () => ({ reassignCustomerRep: vi.fn() }));
vi.mock("@/lib/crm/contactEvents", () => ({ logContactEvent: vi.fn() }));
const scoreOneChat = vi.hoisted(() => vi.fn());
vi.mock("../query", async (orig) => ({
  ...(await orig<typeof import("../query")>()),
  scoreOneChat: (...a: unknown[]) => scoreOneChat(...a),
}));

import { checkHotLead } from "../hotLeads";
import { isClaimableBy } from "../query";

const hotRow = {
  conversationId: "c1",
  name: "Rahul",
  phone: "+91",
  assignedToUserId: null,
  assignedTo: null,
  temperature: "HOT",
  reason: "r",
  requirements: [{ label: "City", value: "Pune" }],
  handoffStatus: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([{ id: "admin1" }]);
});

describe("checkHotLead", () => {
  it("alerts admins and managers the first time a chat is hot", async () => {
    scoreOneChat.mockResolvedValue(hotRow);
    db.aiHotLead.createMany.mockResolvedValue({ count: 1 });
    expect(await checkHotLead("c1")).toEqual({ hot: true, alerted: true });
    expect(push).toHaveBeenCalledWith("admin1", expect.objectContaining({ title: "🔥 Hot lead: Rahul", url: "/ai-chats" }));
  });

  it("does not alert twice", async () => {
    scoreOneChat.mockResolvedValue(hotRow);
    db.aiHotLead.createMany.mockResolvedValue({ count: 0 });
    expect(await checkHotLead("c1")).toEqual({ hot: true, alerted: false });
    expect(push).not.toHaveBeenCalled();
  });

  it("stays quiet for chats that are not hot", async () => {
    scoreOneChat.mockResolvedValue({ ...hotRow, temperature: "WARM" });
    expect(await checkHotLead("c1")).toEqual({ hot: false, alerted: false });
    expect(db.aiHotLead.createMany).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    scoreOneChat.mockRejectedValue(new Error("db down"));
    expect(await checkHotLead("c1")).toEqual({ hot: false, alerted: false });
  });
});

describe("isClaimableBy", () => {
  const sales = { id: "s1", role: "sales" };
  const row = { assignedToUserId: null, temperature: "HOT" as const, handoffStatus: null };
  it("lets sales and managers take an unassigned hot chat", () => {
    expect(isClaimableBy(sales, row)).toBe(true);
    expect(isClaimableBy({ id: "m", role: "manager" }, row)).toBe(true);
  });
  it("refuses taken, not-hot, waiting-for-admin chats and other roles", () => {
    expect(isClaimableBy(sales, { ...row, assignedToUserId: "x" })).toBe(false);
    expect(isClaimableBy(sales, { ...row, temperature: "WARM" })).toBe(false);
    expect(isClaimableBy(sales, { ...row, handoffStatus: "PENDING" })).toBe(false);
    expect(isClaimableBy({ id: "a", role: "management" }, row)).toBe(false);
  });
});
