import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const leadFns = vi.hoisted(() => ({
  update_lead_phone: vi.fn(),
  remove_from_leads: vi.fn(),
  reassign_lead: vi.fn(),
  request_merge: vi.fn(),
  request_mark_won: vi.fn(),
}));
vi.mock("../leads/service", () => ({ LEAD_APPROVAL_EXECUTORS: leadFns }));
const sendMarketing = vi.hoisted(() => vi.fn());
vi.mock("../messaging/send", () => ({ sendMarketingTemplateHandler: (...a: unknown[]) => sendMarketing(...a) }));

import { AREA_EXECUTORS } from "../registry";
import { describeApproval, emptyLookups, toolTitle, collectRefs } from "../approvalView";

const LEAD = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CONVO = "44444444-4444-4444-8444-444444444444";
const ctx = { identityId: "idn-1", userId: "agent-user", credentialId: "approval:x", environment: "staging", correlationId: "corr-1234567", ip: null } as const;
const call = (tool: string, input: unknown) => AREA_EXECUTORS[tool]({ ctx: ctx as any, input, approvalId: "appr-1", approvedByUserId: "u-admin" });

beforeEach(() => vi.clearAllMocks());

describe("executors are wired from each area", () => {
  it("the five lead approvals and the marketing template have one", () => {
    for (const t of ["update_lead_phone", "remove_from_leads", "reassign_lead", "request_merge", "request_mark_won", "send_marketing_template"]) {
      expect(AREA_EXECUTORS[t], t).toBeTypeOf("function");
    }
  });

  it("a lead executor re-validates the stored input, then runs the service once with the AI as actor", async () => {
    leadFns.reassign_lead.mockResolvedValue({ status: 200, body: { assigned: true }, recordIds: [LEAD] });
    const out = await call("reassign_lead", { leadId: LEAD, userId: USER, reason: "Closer to the customer" });
    expect(out).toEqual({ status: 200, body: { assigned: true }, recordIds: [LEAD] });
    expect(leadFns.reassign_lead).toHaveBeenCalledTimes(1);
    expect(leadFns.reassign_lead.mock.calls[0][0]).toMatchObject({
      ctx: { userId: "agent-user" },
      input: { leadId: LEAD, userId: USER, reason: "Closer to the customer" },
    });

    await expect(call("reassign_lead", { leadId: "not-a-uuid", userId: USER, reason: "x" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(call("update_lead_phone", { leadId: LEAD, phone: "abc" })).rejects.toMatchObject({ code: "invalid_input" });
    expect(leadFns.reassign_lead).toHaveBeenCalledTimes(1);
    expect(leadFns.update_lead_phone).not.toHaveBeenCalled();
  });

  it("the marketing executor passes only the three known fields to the handler", async () => {
    sendMarketing.mockResolvedValue({ status: 200, body: { sent: true }, recordIds: [CONVO] });
    const out = await call("send_marketing_template", { conversationId: CONVO, templateId: "tpl-1", variables: ["a"], extra: "ignored" });
    expect(out).toMatchObject({ status: 200, body: { sent: true } });
    expect(sendMarketing.mock.calls[0][0]).toMatchObject({ input: { conversationId: CONVO, templateId: "tpl-1", variables: ["a"] } });
    expect(sendMarketing.mock.calls[0][0].input).not.toHaveProperty("extra");
    await expect(call("send_marketing_template", { templateId: "tpl-1" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("send_reply and send_template have no executor yet (re-running them would re-hold them for the same price check)", () => {
    expect(AREA_EXECUTORS.send_reply).toBeUndefined();
    expect(AREA_EXECUTORS.send_template).toBeUndefined();
  });
});

describe("what the approver sees", () => {
  it("shows the exact message text and why it is waiting", () => {
    const lookups = emptyLookups();
    lookups.chats.set(CONVO, { name: "Ravi Kumar", phone: "919876543210" });
    const d = describeApproval(
      "send_reply",
      { conversationId: CONVO, text: "We can do it for 4.5 lakh.\nDelivery by 20 Nov.", reference: null, reason: "needs_approval_price_or_commitment", categories: ["price", "commitment"] },
      lookups,
    );
    expect(d.title).toBe("Send a WhatsApp message");
    expect(d.customers).toEqual([expect.objectContaining({ kind: "chat", name: "Ravi Kumar", phone: "919876543210", role: "Sent to" })]);
    expect(d.details).toContainEqual({ label: "Message", value: "We can do it for 4.5 lakh.\nDelivery by 20 Nov.", long: true });
    expect(d.details.find((x) => x.label === "Why it is waiting")?.value).toBe("The message mentions a price, a promise (date, warranty or guarantee).");
    // the code word and the raw category list are not shown
    expect(d.details.map((x) => x.label)).not.toContain("Reason");
    expect(JSON.stringify(d.details)).not.toContain("needs_approval_");
  });

  it("formats rupees and dates, names the lead and the new owner", () => {
    const lookups = emptyLookups();
    lookups.leads.set(LEAD, { name: "Asha Mehta", phone: "+919800000000", company: "Mehta Sports" });
    lookups.users.set(USER, "Priya Nair");
    const won = describeApproval("request_mark_won", { leadId: LEAD, value: 450000, expectedStartAt: "2026-11-20T00:00:00.000Z", note: "Signed today" }, lookups);
    expect(won.customers[0]).toMatchObject({ name: "Asha Mehta", company: "Mehta Sports", href: `/crm/contacts/${LEAD}` });
    expect(won.details).toContainEqual({ label: "Deal value", value: "₹4,50,000", long: false });
    expect(won.details.find((x) => x.label === "Expected start")?.value).toMatch(/20 Nov 2026/);

    const moved = describeApproval("reassign_lead", { leadId: LEAD, userId: USER, reason: "Closer" }, lookups);
    expect(moved.details).toContainEqual({ label: "Give to", value: "Priya Nair" });
  });

  it("lists every field of a tool it does not know, so nothing is hidden", () => {
    const d = describeApproval("create_court_design", { widthFt: 60, surface: "acrylic", notes: "Corner court" }, emptyLookups());
    expect(d.title).toBe("Create court design");
    expect(d.details.map((x) => x.label)).toEqual(["Width ft", "Surface", "Notes"]);
    expect(toolTitle("")).toBe("AI request");
  });

  it("collects the ids to look up", () => {
    expect(collectRefs({ primaryLeadId: "a", duplicateLeadIds: ["b", "c"], conversationId: "d", templateId: "e", userId: "f" })).toEqual({
      leadIds: ["a", "b", "c"],
      chatIds: ["d"],
      userIds: ["f"],
      templateIds: ["e"],
    });
    expect(collectRefs(null)).toEqual({ leadIds: [], chatIds: [], userIds: [], templateIds: [] });
  });
});
