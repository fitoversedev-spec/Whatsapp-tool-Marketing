import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  message: { findMany: vi.fn(), create: vi.fn() },
  optOut: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  contact: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  template: { findUnique: vi.fn(), findMany: vi.fn() },
  accountContact: { findMany: vi.fn() },
  metaLead: { findMany: vi.fn() },
  setting: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
// No chat in these tests has an AI → human handoff (covered in handoffs.*.test.ts).
vi.mock("../handoffs/service", () => ({ handoffGate: async () => null }));
vi.mock("@/lib/ai-chats/hotLeads", () => ({ checkHotLead: async () => ({ hot: false, alerted: false }) }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));

const wa = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendTemplate: vi.fn(),
  isMetaConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendText: (...a: unknown[]) => wa.sendText(...a),
  sendTemplate: (...a: unknown[]) => wa.sendTemplate(...a),
  isMetaConfigured: (...a: unknown[]) => wa.isMetaConfigured(...a),
  describeMetaError: (e: { code?: string; message?: string }) => ({ code: e.code ?? "x", message: e.message ?? "boom" }),
}));
const requestApproval = vi.hoisted(() => vi.fn());
vi.mock("../approvals", () => ({ requestApproval: (...a: unknown[]) => requestApproval(...a) }));

import type { AgentHandlerArgs, AgentHandlerResult } from "../withAgent";
import { AgentHttpError } from "../errors";
import { consentOffHandler, recordOptOutHandler } from "../messaging/consent";
import { resetConversationLimitCache } from "../messaging/limits";
import {
  getEligibilityHandler,
  getEventsHandler,
  getMessagesHandler,
  listConversationsHandler,
  listTemplatesHandler,
} from "../messaging/reads";
import { sendMarketingTemplateHandler, sendReplyHandler, sendTemplateHandler } from "../messaging/send";
import { encodeCursor } from "../messaging/events";

const CTX = {
  identityId: "idn-1",
  userId: "agent-user",
  credentialId: "cred-1",
  environment: "staging" as const,
  correlationId: "corr-12345678",
  ip: null,
};
const CONVO = "11111111-1111-4111-8111-111111111111";
const H = 3_600_000;

function args<I>(input: I, params: Record<string, string> = { id: CONVO }): AgentHandlerArgs<I> {
  return {
    ctx: CTX,
    meta: { identityName: "a", credentialLabel: "l", keyPrefix: "fvai_stg_x", expiresAt: null },
    input,
    req: new Request("https://app.test/x"),
    params,
    idempotencyKey: "idem-key-0001",
  };
}
const errorCode = (r: AgentHandlerResult) => (r.body as { error: { code: string } }).error.code;
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as AgentHttpError;
  }
  throw new Error("expected a rejection");
};

const openConvo = () => ({ id: CONVO, contactPhone: "919876543210", lastInboundAt: new Date(Date.now() - 2 * H) });
const msgRow = (over: Record<string, unknown> = {}) => ({
  id: "msg-1",
  direction: "outbound",
  type: "text",
  body: "Hello",
  mediaMimeType: null,
  mediaFileName: null,
  status: "sent",
  createdAt: new Date(),
  sentByUserId: "agent-user",
  templateId: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetConversationLimitCache();
  db.conversation.findUnique.mockResolvedValue(openConvo());
  db.conversation.update.mockResolvedValue({ id: CONVO });
  db.optOut.findFirst.mockResolvedValue(null);
  db.contact.findFirst.mockResolvedValue({ allowCampaign: true });
  db.message.findMany.mockResolvedValue([]);
  db.message.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => msgRow({ id: "msg-new", ...data }));
  db.setting.findUnique.mockResolvedValue(null);
  db.$queryRaw.mockResolvedValue([{ count: 1 }]);
  wa.isMetaConfigured.mockResolvedValue(true);
  wa.sendText.mockResolvedValue({ waMessageId: "wamid.1" });
  wa.sendTemplate.mockResolvedValue({ waMessageId: "wamid.T1" });
  requestApproval.mockResolvedValue({ approvalId: "appr-1", created: true });
});

describe("send_reply", () => {
  const reply = (text: string, reference?: string) => sendReplyHandler(args({ text, reference }));

  it("sends to the conversation's own number and mirrors it as an AI message", async () => {
    const r = await reply("Thanks for your message! Which sport is it for?", "task-9");
    expect(wa.sendText).toHaveBeenCalledWith({ to: "919876543210", body: "Thanks for your message! Which sport is it for?" });
    expect(db.message.create).toHaveBeenCalledTimes(1);
    expect(db.message.create.mock.calls[0][0].data).toMatchObject({
      conversationId: CONVO,
      direction: "outbound",
      type: "text",
      waMessageId: "wamid.1",
      status: "sent",
      sentByUserId: "agent-user",
    });
    // last-message field only: no unread reset, no auto-assignment to the AI
    expect(db.conversation.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(db.conversation.update.mock.calls[0][0].data)).toEqual(["lastOutboundAt"]);
    expect(r.body).toMatchObject({ sent: true, duplicate: false, mirrored: true, waMessageId: "wamid.1", reference: "task-9" });
    expect((r.body as { message: { sentBy: string } }).message.sentBy).toBe("ai_agent");
  });

  it("never sends to an opted-out contact, and says so", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
    const r = await reply("Hello again");
    expect(r.status).toBe(403);
    expect(errorCode(r)).toBe("opted_out");
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(r.action).toBe("refused:opted_out");
  });

  it("refuses outside the 24 hour window and points to templates", async () => {
    db.conversation.findUnique.mockResolvedValue({ ...openConvo(), lastInboundAt: new Date(Date.now() - 30 * H) });
    const r = await reply("Hello");
    expect(r.status).toBe(409);
    expect(errorCode(r)).toBe("window_closed");
    expect((r.body as { error: { message: string } }).error.message).toMatch(/send_template/);
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it("refuses a contact who never messaged us", async () => {
    db.conversation.findUnique.mockResolvedValue({ ...openConvo(), lastInboundAt: null });
    expect(errorCode(await reply("Hello"))).toBe("window_closed");
  });

  it("campaign consent off does not stop a reply inside the window", async () => {
    db.contact.findFirst.mockResolvedValue({ allowCampaign: false });
    const r = await reply("Happy to help with that");
    expect(r.body).toMatchObject({ sent: true });
    expect(wa.sendText).toHaveBeenCalled();
  });

  it("holds a message with a price for approval instead of sending", async () => {
    const r = await reply("The court will cost ₹5,00,000 with 10% discount");
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({
      approvalId: "appr-1",
      status: "pending",
      reason: "needs_approval_price_or_commitment",
    });
    expect((r.body as { categories: string[] }).categories).toEqual(expect.arrayContaining(["price", "discount"]));
    expect(requestApproval).toHaveBeenCalledTimes(1);
    const call = requestApproval.mock.calls[0][0];
    expect(call).toMatchObject({ identityId: "idn-1", toolName: "send_reply" });
    expect(call.input).toMatchObject({ conversationId: CONVO, text: "The court will cost ₹5,00,000 with 10% discount" });
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(r.recordIds).toContain("appr-1");
  });

  it("holds promises (delivery date, warranty) too", async () => {
    expect((await reply("We will deliver by Friday")).status).toBe(202);
    expect((await reply("It comes with a 5 year warranty")).status).toBe(202);
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it("checks opt-out before the guard: no approval is queued for an impossible send", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
    const r = await reply("Price is Rs 5000");
    expect(errorCode(r)).toBe("opted_out");
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("returns the earlier message for the same text within 10 minutes", async () => {
    db.message.findMany.mockResolvedValue([msgRow({ id: "earlier", body: "  Hello  there ", createdAt: new Date(Date.now() - 120_000) })]);
    const r = await reply("hello there");
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled(); // a duplicate does not use up the hourly budget
    expect(r.body).toMatchObject({ sent: false, duplicate: true });
    expect((r.body as { message: { id: string } }).message.id).toBe("earlier");
  });

  it("sends again once the earlier copy is older than 10 minutes", async () => {
    db.message.findMany.mockResolvedValue([msgRow({ body: "Hello there", createdAt: new Date(Date.now() - 11 * 60_000) })]);
    const r = await reply("Hello there");
    expect(r.body).toMatchObject({ sent: true });
  });

  it("enforces the per-conversation hourly limit (default 10)", async () => {
    db.$queryRaw.mockResolvedValue([{ count: 11 }]);
    const r = await reply("Hello");
    expect(r.status).toBe(429);
    expect(errorCode(r)).toBe("rate_limited");
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(JSON.stringify(db.$queryRaw.mock.calls[0])).toContain(`conv:${CONVO}`);
  });

  it("reads the limit from the agent_rate_limits setting", async () => {
    db.setting.findUnique.mockResolvedValue({ value: JSON.stringify({ perConversationHour: 3 }) });
    db.$queryRaw.mockResolvedValue([{ count: 4 }]);
    const r = await reply("Hello");
    expect(r.status).toBe(429);
    expect((r.body as { error: { message: string } }).error.message).toMatch(/At most 3 messages/);
  });

  it("does not fail (and so is never re-sent) when saving after a successful send fails", async () => {
    db.message.create.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await reply("Hello");
    err.mockRestore();
    expect(r.body).toMatchObject({ sent: true, mirrored: false, waMessageId: "wamid.1", message: null });
    expect(wa.sendText).toHaveBeenCalledTimes(1);
  });

  it("refuses to guess when WhatsApp times out", async () => {
    wa.sendText.mockRejectedValue({ code: "timeout", message: "slow" });
    const r = await reply("Hello");
    expect(r.status).toBe(409);
    expect(errorCode(r)).toBe("delivery_unknown");
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("turns a WhatsApp rejection into a retryable 502 and writes nothing", async () => {
    wa.sendText.mockRejectedValue({ code: "131047", message: "Re-engagement message" });
    const e = await rejects(reply("Hello"));
    expect(e).toBeInstanceOf(AgentHttpError);
    expect(e.status).toBe(502);
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("is a 503 when WhatsApp is not configured", async () => {
    wa.isMetaConfigured.mockResolvedValue(false);
    expect((await rejects(reply("Hello"))).status).toBe(503);
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it("is a 404 for an unknown conversation and a 400 for a malformed id", async () => {
    db.conversation.findUnique.mockResolvedValue(null);
    expect((await rejects(reply("Hello"))).code).toBe("not_found");
    expect((await rejects(sendReplyHandler(args({ text: "Hi" }, { id: "../etc" })))).code).toBe("invalid_input");
  });
});

describe("send_template / send_marketing_template", () => {
  const tpl = (over: Record<string, unknown> = {}) => ({
    id: "tpl-1",
    name: "order_update",
    language: "en",
    category: "UTILITY",
    header: null,
    body: "Hi {{1}}, your quote {{2}} is ready.",
    status: "approved",
    deletedAt: null,
    ...over,
  });
  const util = (variables: string[] = ["Rahul", "Q-1043"], templateId = "tpl-1") =>
    sendTemplateHandler(args({ templateId, variables }));
  const mkt = (variables: string[] = ["Rahul", "Q-1043"]) =>
    sendMarketingTemplateHandler(args({ conversationId: CONVO, templateId: "tpl-1", variables }, {}));

  beforeEach(() => db.template.findUnique.mockResolvedValue(tpl()));

  it("sends an approved UTILITY template and mirrors it", async () => {
    const r = await util();
    expect(wa.sendTemplate).toHaveBeenCalledWith({
      to: "919876543210",
      templateName: "order_update",
      language: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: "Rahul" }, { type: "text", text: "Q-1043" }] }],
    });
    expect(db.message.create.mock.calls[0][0].data).toMatchObject({
      type: "template",
      body: "Hi Rahul, your quote Q-1043 is ready.",
      templateId: "tpl-1",
      sentByUserId: "agent-user",
      waMessageId: "wamid.T1",
    });
    expect(r.body).toMatchObject({ sent: true });
  });

  it("works outside the 24 hour window (that is what templates are for)", async () => {
    db.conversation.findUnique.mockResolvedValue({ ...openConvo(), lastInboundAt: new Date(Date.now() - 90 * H) });
    expect((await util()).body).toMatchObject({ sent: true });
  });

  it("rejects MARKETING on send_template with a clear code, before sending", async () => {
    db.template.findUnique.mockResolvedValue(tpl({ category: "MARKETING" }));
    const r = await util();
    expect(r.status).toBe(422);
    expect(errorCode(r)).toBe("use_marketing_tool");
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("never sends AUTHENTICATION templates", async () => {
    db.template.findUnique.mockResolvedValue(tpl({ category: "AUTHENTICATION" }));
    expect(errorCode(await util())).toBe("template_category_not_allowed");
  });

  it("refuses templates that are not approved, and hides deleted or unknown ones", async () => {
    db.template.findUnique.mockResolvedValue(tpl({ status: "submitted" }));
    expect(errorCode(await util())).toBe("template_not_approved");
    db.template.findUnique.mockResolvedValue(tpl({ deletedAt: new Date() }));
    expect((await rejects(util())).code).toBe("not_found");
    db.template.findUnique.mockResolvedValue(null);
    expect((await rejects(util())).code).toBe("not_found");
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("validates the number of variables", async () => {
    const e = await rejects(util(["Rahul"]));
    expect(e.code).toBe("invalid_input");
    expect(e.message).toMatch(/exactly 2 variables; got 1/);
    expect((await rejects(util(["a", "b", "c"]))).code).toBe("invalid_input");
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("refuses an opted-out contact before even looking at the template", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
    const r = await util();
    expect(errorCode(r)).toBe("opted_out");
    expect(db.template.findUnique).not.toHaveBeenCalled();
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("holds a template whose variables carry a price", async () => {
    const r = await util(["Rahul", "₹5,00,000"]);
    expect(r.status).toBe(202);
    expect(requestApproval.mock.calls[0][0]).toMatchObject({
      toolName: "send_template",
      input: { conversationId: CONVO, templateId: "tpl-1", variables: ["Rahul", "₹5,00,000"] },
    });
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("drops the duplicate of an identical template sent in the last 10 minutes", async () => {
    db.message.findMany.mockResolvedValue([
      msgRow({ id: "prev", type: "template", templateId: "tpl-1", body: "Hi Rahul, your quote Q-1043 is ready.", createdAt: new Date(Date.now() - 60_000) }),
    ]);
    const r = await util();
    expect(r.body).toMatchObject({ sent: false, duplicate: true });
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  it("shares the per-conversation hourly budget with free-text replies", async () => {
    db.$queryRaw.mockResolvedValue([{ count: 11 }]);
    expect((await util()).status).toBe(429);
  });

  describe("send_marketing_template (runs only after a human approved it)", () => {
    beforeEach(() => db.template.findUnique.mockResolvedValue(tpl({ category: "MARKETING" })));

    it("sends a MARKETING template to a contact with campaign consent", async () => {
      const r = await mkt();
      expect(r.body).toMatchObject({ sent: true });
      expect(wa.sendTemplate).toHaveBeenCalledTimes(1);
    });
    it("needs allowCampaign: false and 'no record' both refuse", async () => {
      db.contact.findFirst.mockResolvedValue({ allowCampaign: false });
      expect(errorCode(await mkt())).toBe("no_campaign_consent");
      db.contact.findFirst.mockResolvedValue(null);
      const r = await mkt();
      expect(r.status).toBe(403);
      expect(errorCode(r)).toBe("no_campaign_consent");
      expect(wa.sendTemplate).not.toHaveBeenCalled();
    });
    it("never reaches an opted-out contact, even with consent", async () => {
      db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
      expect(errorCode(await mkt())).toBe("opted_out");
      expect(wa.sendTemplate).not.toHaveBeenCalled();
    });
    it("refuses a UTILITY template", async () => {
      db.template.findUnique.mockResolvedValue(tpl({ category: "UTILITY" }));
      expect(errorCode(await mkt())).toBe("use_send_template");
    });
  });
});

describe("record_opt_out", () => {
  const optOut = (input: Record<string, unknown>) => recordOptOutHandler(args(input as never, {}));

  it("upserts the OptOut the way the webhook keys it (digits only, no +)", async () => {
    db.optOut.findUnique.mockResolvedValue(null);
    const r = await optOut({ phone: "+91 98765 43210", reason: "asked to stop on call" });
    expect(db.optOut.upsert).toHaveBeenCalledWith({
      where: { phoneE164: "919876543210" },
      create: { phoneE164: "919876543210", reason: "agent: asked to stop on call" },
      update: {},
    });
    expect(r.body).toEqual({ phone: "919876543210", optedOut: true, alreadyOptedOut: false });
    expect(r.fieldsChanged).toEqual(["opt_out"]);
  });
  it("is idempotent: an existing opt-out is left untouched and reported", async () => {
    db.optOut.findUnique.mockResolvedValue({ phoneE164: "919876543210" });
    const r = await optOut({ phone: "919876543210", reason: "again" });
    expect(db.optOut.upsert.mock.calls[0][0].update).toEqual({});
    expect(r.body).toMatchObject({ optedOut: true, alreadyOptedOut: true });
    expect(r.fieldsChanged).toEqual([]);
  });
  it("accepts a conversationId and derives the phone from it", async () => {
    db.conversation.findUnique.mockResolvedValue({ id: CONVO, contactPhone: "919876543210", contactName: "Rahul" });
    db.optOut.findUnique.mockResolvedValue(null);
    const r = await optOut({ conversationId: CONVO, reason: "stop" });
    expect(db.optOut.upsert.mock.calls[0][0].where).toEqual({ phoneE164: "919876543210" });
    expect(r.recordIds).toEqual([CONVO]);
  });
  it("rejects an unknown conversation and an unusable phone", async () => {
    db.conversation.findUnique.mockResolvedValue(null);
    expect((await rejects(optOut({ conversationId: CONVO, reason: "x" }))).code).toBe("not_found");
    expect((await rejects(optOut({ phone: "abc", reason: "x" }))).code).toBe("invalid_input");
    expect(db.optOut.upsert).not.toHaveBeenCalled();
  });
});

describe("set_campaign_consent_false", () => {
  it("turns consent off on an existing contact", async () => {
    db.contact.findUnique.mockResolvedValue({ id: "ct-1" });
    db.contact.upsert.mockResolvedValue({ id: "ct-1" });
    const r = await consentOffHandler(args({ phone: "9876543210" } as never, {}));
    expect(db.contact.upsert).toHaveBeenCalledWith({
      where: { phone: "919876543210" },
      create: { phone: "919876543210", name: null, allowCampaign: false },
      update: { allowCampaign: false },
      select: { id: true },
    });
    expect(r.body).toEqual({ phone: "919876543210", allowCampaign: false, created: false });
  });
  it("creates the contact with consent already off when none exists", async () => {
    db.conversation.findUnique.mockResolvedValue({ id: CONVO, contactPhone: "919876543210", contactName: "Rahul" });
    db.contact.findUnique.mockResolvedValue(null);
    db.contact.upsert.mockResolvedValue({ id: "ct-new" });
    const r = await consentOffHandler(args({ conversationId: CONVO } as never, {}));
    expect(db.contact.upsert.mock.calls[0][0].create).toEqual({ phone: "919876543210", name: "Rahul", allowCampaign: false });
    expect(r.body).toMatchObject({ allowCampaign: false, created: true });
  });
});

describe("read tools", () => {
  it("get_messages never touches the conversation (no unread reset) and labels senders", async () => {
    db.message.findMany.mockResolvedValue([
      msgRow({ id: "m3", direction: "outbound", sentByUserId: "agent-user", createdAt: new Date("2026-10-13T10:03:00Z") }),
      msgRow({ id: "m2", direction: "outbound", sentByUserId: "someone-else", createdAt: new Date("2026-10-13T10:02:00Z") }),
      msgRow({ id: "m1", direction: "inbound", sentByUserId: null, createdAt: new Date("2026-10-13T10:01:00Z") }),
    ]);
    const r = await getMessagesHandler(args({ limit: 2 }));
    const body = r.body as { messages: { id: string; sentBy: string | null }[]; hasMore: boolean; nextBefore: string | null };
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(db.conversation.findUnique.mock.calls[0][0].select).not.toHaveProperty("unreadCount");
    expect(body.hasMore).toBe(true);
    expect(body.messages.map((m) => m.id)).toEqual(["m2", "m3"]); // oldest first, extra row dropped
    expect(body.messages.map((m) => m.sentBy)).toEqual(["staff", "ai_agent"]);
    expect(body.nextBefore).toBe("2026-10-13T10:02:00.000Z");
    expect(JSON.stringify(body)).not.toContain("mediaUrl");
  });

  it("list_conversations flags the window and opt-out, pages by cursor and hides notes", async () => {
    const t = (h: number) => new Date(Date.now() - h * H);
    db.conversation.findMany.mockResolvedValue([
      { id: "c1", contactName: "A", contactPhone: "911", status: "open", unreadCount: 2, lastInboundAt: t(1), lastOutboundAt: t(0.5), assignedToUserId: "u1" },
      { id: "c2", contactName: "B", contactPhone: "922", status: "open", unreadCount: 0, lastInboundAt: t(30), lastOutboundAt: null, assignedToUserId: null },
      { id: "c3", contactName: "C", contactPhone: "933", status: "open", unreadCount: 0, lastInboundAt: t(31), lastOutboundAt: null, assignedToUserId: null },
    ]);
    db.optOut.findMany.mockResolvedValue([{ phoneE164: "922" }]);
    const r = await listConversationsHandler(args({ limit: 2 }, {}));
    const body = r.body as { conversations: Record<string, unknown>[]; nextCursor: string | null };
    expect(body.conversations).toHaveLength(2);
    expect(body.conversations[0]).toMatchObject({ id: "c1", windowOpen: true, optedOut: false, assignedToHuman: true, phone: "911" });
    expect(body.conversations[1]).toMatchObject({ id: "c2", windowOpen: false, optedOut: true, assignedToHuman: false });
    expect(body.nextCursor).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/note/i);
    expect(db.conversation.findMany.mock.calls[0][0].take).toBe(3);
    expect(db.conversation.findMany.mock.calls[0][0].select).not.toHaveProperty("notes");
  });

  it("list_conversations rejects a cursor we did not issue", async () => {
    expect((await rejects(listConversationsHandler(args({ limit: 5, cursor: "garbage" }, {})))).code).toBe("invalid_input");
  });

  it("get_send_eligibility reports the decision", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
    const r = await getEligibilityHandler(args({}));
    expect(r.body).toMatchObject({
      conversationId: CONVO,
      canReplyFreeText: false,
      optedOut: true,
      reasonIfNot: "opted_out",
      allowCampaign: true,
    });
  });

  it("list_templates returns approved, non-deleted UTILITY/MARKETING only, with variables", async () => {
    db.template.findMany.mockResolvedValue([
      { id: "t1", name: "a", language: "en", category: "UTILITY", body: "Hi {{1}}", status: "approved" },
      { id: "t2", name: "b", language: "en", category: "MARKETING", body: "Sale", status: "approved" },
      { id: "t3", name: "c", language: "en", category: "UTILITY", body: "Draft", status: "draft" },
      { id: "t4", name: "d", language: "en", category: "AUTHENTICATION", body: "OTP {{1}}", status: "approved" },
    ]);
    const all = (await listTemplatesHandler(args({}, {}))).body as { templates: { id: string; variables: number[]; usableWith: string }[] };
    expect(db.template.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(all.templates.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(all.templates[0]).toMatchObject({ variables: [1], variableCount: 1, usableWith: "send_template" });
    expect(all.templates[1].usableWith).toBe("send_marketing_template");
    const onlyMkt = (await listTemplatesHandler(args({ category: "MARKETING" }, {}))).body as { templates: { id: string }[] };
    expect(onlyMkt.templates.map((t) => t.id)).toEqual(["t2"]);
  });

  describe("get_events", () => {
    const events = (input: Record<string, unknown>) => getEventsHandler(args({ limit: 100, ...input } as never, {}));
    const recent = () => new Date(Date.now() - 3600_000).toISOString();

    beforeEach(() => {
      db.message.findMany.mockResolvedValue([]);
      db.accountContact.findMany.mockResolvedValue([]);
      db.metaLead.findMany.mockResolvedValue([]);
    });

    it("refuses a start older than 7 days and says the earliest allowed time", async () => {
      const e = await rejects(events({ since: new Date(Date.now() - 8 * 86_400_000).toISOString() }));
      expect(e.code).toBe("invalid_input");
      expect(e.message).toMatch(/last 7 days/);
      expect(db.message.findMany).not.toHaveBeenCalled();
    });
    it("rejects unknown types and a bad cursor", async () => {
      expect((await rejects(events({ since: recent(), types: "message,spam" }))).code).toBe("invalid_input");
      expect((await rejects(events({ cursor: "garbage" }))).code).toBe("invalid_input");
    });
    it("merges inbound messages, CRM leads and ad leads in time order with a cursor", async () => {
      const at = (s: number) => new Date(Date.now() - 60_000 + s * 1000);
      db.message.findMany.mockResolvedValue([
        { id: "m1", createdAt: at(2), type: "text", body: "x".repeat(2000), conversationId: CONVO, conversation: { contactName: "A", contactPhone: "911" } },
      ]);
      db.accountContact.findMany
        .mockResolvedValueOnce([{ id: "c1", name: "Crm Lead", phone: "922", createdAt: at(-100), promotedToLeadAt: at(1) }])
        .mockResolvedValueOnce([{ id: "c2", name: "Old Style", phone: "933", createdAt: at(3), promotedToLeadAt: null }]);
      db.metaLead.findMany.mockResolvedValue([
        { id: "ad1", createdAt: at(4), fullName: "Ad Lead", phone: "944", city: "Pune", sport: "badminton", campaignName: "Oct" },
      ]);
      const r = await events({ since: recent(), limit: 3 });
      const body = r.body as { events: { id: string; type: string; source: string; body?: string | null }[]; hasMore: boolean; nextCursor: string };
      expect(body.events.map((e) => e.id)).toEqual(["c1", "m1", "c2"]);
      expect(body.events.map((e) => e.source)).toEqual(["crm", "whatsapp", "crm"]);
      expect(body.events[1].body).toHaveLength(1000);
      expect(body.hasMore).toBe(true);
      expect(body.nextCursor).toBeTruthy();
      // each source is asked for limit+1 rows, oldest first
      expect(db.message.findMany.mock.calls[0][0]).toMatchObject({ take: 4 });
      expect(db.metaLead.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    });
    it("only queries the requested types", async () => {
      await events({ since: recent(), types: "lead" });
      expect(db.message.findMany).not.toHaveBeenCalled();
      expect(db.metaLead.findMany).toHaveBeenCalled();
      db.metaLead.findMany.mockClear();
      await events({ since: recent(), types: "message" });
      expect(db.metaLead.findMany).not.toHaveBeenCalled();
      expect(db.accountContact.findMany).toHaveBeenCalledTimes(2); // only from the 'lead' call
    });
    it("continues strictly after a cursor", async () => {
      const t = new Date(Date.now() - 1000);
      await events({ cursor: encodeCursor({ t, id: "last-id" }), types: "message" });
      const where = db.message.findMany.mock.calls[0][0].where as { AND: unknown[] };
      expect(JSON.stringify(where.AND[2])).toContain('"id":{"gt":"last-id"}');
    });
  });
});
