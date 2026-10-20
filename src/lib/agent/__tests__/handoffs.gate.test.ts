import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aiHumanHandoff: { findFirst: vi.fn() },
  message: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { handoffGate } from "../handoffs/service";

const ctx = { identityId: "i", userId: "u", credentialId: "c", environment: "development", correlationId: "corr", ip: null } as const;
const pending = { id: "h1", conversationId: "c1", status: "PENDING", requestedAt: new Date("2026-10-20T10:00:00Z") };

beforeEach(() => {
  db.aiHumanHandoff.findFirst.mockReset();
  db.message.findFirst.mockReset();
});

describe("handoffGate", () => {
  it("lets the AI send when the chat has no handoff", async () => {
    db.aiHumanHandoff.findFirst.mockResolvedValue(null);
    expect(await handoffGate(ctx, "c1")).toBeNull();
    expect(db.message.findFirst).not.toHaveBeenCalled();
  });

  it("refuses with human_assigned once a salesperson has the chat", async () => {
    db.aiHumanHandoff.findFirst.mockResolvedValue({ ...pending, status: "APPROVED" });
    const r = await handoffGate(ctx, "c1");
    expect(r?.status).toBe(409);
    expect(r?.body).toMatchObject({ error: { code: "human_assigned" } });
  });

  it("while pending, waits for the customer after the AI has spoken", async () => {
    db.aiHumanHandoff.findFirst.mockResolvedValue(pending);
    db.message.findFirst.mockResolvedValue({ direction: "outbound" });
    expect((await handoffGate(ctx, "c1"))?.body).toMatchObject({ error: { code: "waiting_for_customer" } });

    db.message.findFirst.mockResolvedValue({ direction: "inbound" });
    expect(await handoffGate(ctx, "c1")).toBeNull();
  });
});
