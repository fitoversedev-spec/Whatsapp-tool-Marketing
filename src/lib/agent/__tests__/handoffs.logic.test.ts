import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { decideAiMode, introText, isHandoffStatus, salesAssignedGuidance } from "../handoffs/logic";
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

  it("customer asked for a person: one holding reply, then only when the customer writes", () => {
    const h = { status: "PENDING", kind: "CUSTOMER_REQUEST" };
    expect(decideAiMode(h, null)).toMatchObject({ canReply: true, reason: "holding_reply_allowed" });
    expect(decideAiMode(h, { direction: "outbound" })).toMatchObject({ canReply: false, reason: "waiting_for_customer" });
    expect(decideAiMode(h, { direction: "inbound" })).toMatchObject({ canReply: true, reason: "customer_wrote_again" });
  });

  it("a salesperson's request does not hold the AI back", () => {
    expect(decideAiMode({ status: "PENDING", kind: "SALES_REQUEST" }, { direction: "outbound" })).toEqual({
      mode: "ai",
      canReply: true,
      reason: "sales_requested",
    });
  });

  it("keeps answering once a salesperson is assigned", () => {
    expect(decideAiMode({ status: "APPROVED", kind: "ADMIN_ASSIGN" }, { direction: "outbound" })).toEqual({
      mode: "sales_assigned",
      canReply: true,
      reason: "sales_assigned",
    });
  });
});

describe("salesperson introduction", () => {
  it("names the salesperson and their number", () => {
    expect(introText("Rahul Mehta", { name: "Priya", phone: "+919800000001" })).toBe(
      "Hi Rahul! Priya from the Fitoverse sales team will contact you from +919800000001 to take this forward. I'm still here for any product or technical questions.",
    );
    expect(introText(null, { name: "Priya", phone: null })).toContain("will contact you shortly");
  });

  it("tells the AI to leave commercial topics to the salesperson", () => {
    const g = salesAssignedGuidance({ name: "Priya", phone: "+919800000001" });
    expect(g).toContain("Priya (+919800000001)");
    expect(g).toMatch(/price, quotations, discounts/);
  });
});

describe("handoff tools", () => {
  it("are registered and allowed", () => {
    expect(TOOL_REGISTRY.request_human_handoff?.default).toBe("ALLOWED");
    expect(TOOL_REGISTRY.get_ai_status?.default).toBe("ALLOWED");
    expect(TOOL_REGISTRY.start_lead_conversation?.default).toBe("ALLOWED");
  });

  it("recognises statuses", () => {
    expect(isHandoffStatus("PENDING")).toBe(true);
    expect(isHandoffStatus("pending")).toBe(false);
  });
});
