import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { decideAiMode, isHandoffStatus } from "../handoffs/logic";
import { TOOL_REGISTRY } from "../permissions";

describe("decideAiMode", () => {
  it("leaves the AI in charge when there is no handoff", () => {
    expect(decideAiMode(null, null)).toEqual({ mode: "ai", canReply: true, reason: "no_handoff" });
  });

  it("ignores finished handoffs", () => {
    for (const status of ["REJECTED", "RELEASED"]) {
      expect(decideAiMode({ status }, { direction: "outbound" })).toMatchObject({ mode: "ai", canReply: true });
    }
  });

  it("while waiting: allows one holding reply right after the request", () => {
    expect(decideAiMode({ status: "PENDING" }, null)).toEqual({
      mode: "waiting_for_human",
      canReply: true,
      reason: "holding_reply_allowed",
    });
  });

  it("while waiting: replies only when the customer spoke last", () => {
    expect(decideAiMode({ status: "PENDING" }, { direction: "outbound" })).toEqual({
      mode: "waiting_for_human",
      canReply: false,
      reason: "waiting_for_customer",
    });
    expect(decideAiMode({ status: "PENDING" }, { direction: "inbound" })).toEqual({
      mode: "waiting_for_human",
      canReply: true,
      reason: "customer_wrote_again",
    });
  });

  it("stays silent once a salesperson is assigned, even if the customer writes", () => {
    expect(decideAiMode({ status: "APPROVED" }, { direction: "inbound" })).toEqual({
      mode: "human",
      canReply: false,
      reason: "human_assigned",
    });
  });
});

describe("handoff tools", () => {
  it("are registered and allowed", () => {
    expect(TOOL_REGISTRY.request_human_handoff?.default).toBe("ALLOWED");
    expect(TOOL_REGISTRY.get_ai_status?.default).toBe("ALLOWED");
  });

  it("recognises statuses", () => {
    expect(isHandoffStatus("PENDING")).toBe(true);
    expect(isHandoffStatus("pending")).toBe(false);
  });
});
