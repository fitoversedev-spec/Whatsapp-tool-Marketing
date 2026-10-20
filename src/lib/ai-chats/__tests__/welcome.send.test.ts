import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  metaLead: { findUnique: vi.fn(), updateMany: vi.fn() },
  aiLeadOutreach: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  optOut: { findFirst: vi.fn() },
  conversation: { findUnique: vi.fn(), upsert: vi.fn() },
  setting: { findUnique: vi.fn() },
  template: { findUnique: vi.fn() },
  message: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const wa = vi.hoisted(() => ({ sendTemplate: vi.fn(), isMetaConfigured: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({
  sendTemplate: (...a: unknown[]) => wa.sendTemplate(...a),
  isMetaConfigured: () => wa.isMetaConfigured(),
  describeMetaError: () => ({ code: "x", message: "boom" }),
}));

import { startLeadConversation } from "../welcome";

const lead = { id: "L1", fullName: "Karan Shah", phone: "+91 98111 22233", normalizedPhone: null, stage: "NEW" };
const template = { id: "T1", name: "fitoverse_welcome", language: "en", header: null, body: "Hi {{1}}, thanks for your enquiry!", status: "approved", deletedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.metaLead.findUnique.mockResolvedValue(lead);
  db.aiLeadOutreach.findUnique.mockResolvedValue(null);
  db.optOut.findFirst.mockResolvedValue(null);
  db.conversation.findUnique.mockResolvedValue(null);
  db.setting.findUnique.mockResolvedValue({ value: '{"templateIds":["T1"]}' });
  db.template.findUnique.mockResolvedValue(template);
  db.aiLeadOutreach.create.mockResolvedValue({ id: "O1" });
  db.conversation.upsert.mockResolvedValue({ id: "C1" });
  db.message.create.mockResolvedValue({ id: "M1" });
  wa.isMetaConfigured.mockResolvedValue(true);
  wa.sendTemplate.mockResolvedValue({ waMessageId: "wamid.1" });
});

describe("startLeadConversation", () => {
  it("sends the welcome template with the first name and opens the chat", async () => {
    const r = await startLeadConversation({ metaLeadId: "L1", agentUserId: "AI" });
    expect(r).toMatchObject({ ok: true, status: 201, body: { sent: true, conversationId: "C1", text: "Hi Karan, thanks for your enquiry!" } });
    expect(wa.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: "919811122233", templateName: "fitoverse_welcome" }));
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sentByUserId: "AI", type: "template" }) }));
    expect(db.metaLead.updateMany).toHaveBeenCalledWith({ where: { id: "L1", stage: "NEW" }, data: { stage: "CONTACTED" } });
  });

  it("sends once per lead", async () => {
    db.aiLeadOutreach.findUnique.mockResolvedValue({ id: "O1", status: "sent", conversationId: "C1", templateId: "T1" });
    const r = await startLeadConversation({ metaLeadId: "L1", agentUserId: "AI" });
    expect(r).toMatchObject({ ok: true, status: 200, body: { deduplicated: true, conversationId: "C1" } });
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("never messages an opted-out number", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919811122233" });
    expect(await startLeadConversation({ metaLeadId: "L1", agentUserId: "AI" })).toMatchObject({ ok: false, code: "opted_out" });
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("refuses templates the admin did not pick, and when none is set", async () => {
    expect(await startLeadConversation({ metaLeadId: "L1", agentUserId: "AI", templateId: "OTHER" })).toMatchObject({ code: "template_not_allowed" });
    db.setting.findUnique.mockResolvedValue(null);
    expect(await startLeadConversation({ metaLeadId: "L1", agentUserId: "AI" })).toMatchObject({ code: "no_welcome_template" });
  });

  it("points to the live chat when the customer is already messaging", async () => {
    db.conversation.findUnique.mockResolvedValue({ id: "C9", lastInboundAt: new Date() });
    expect(await startLeadConversation({ metaLeadId: "L1", agentUserId: "AI" })).toMatchObject({
      code: "already_chatting",
      extra: { conversationId: "C9" },
    });
  });

  it("frees the lead again if WhatsApp rejects the send", async () => {
    wa.sendTemplate.mockRejectedValue(new Error("rejected"));
    db.aiLeadOutreach.delete.mockResolvedValue({ id: "O1" });
    expect(await startLeadConversation({ metaLeadId: "L1", agentUserId: "AI" })).toMatchObject({ ok: false, code: "send_failed" });
    expect(db.aiLeadOutreach.delete).toHaveBeenCalledWith({ where: { id: "O1" } });
  });
});
