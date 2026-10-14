import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  courtImage: { findUnique: vi.fn(), update: vi.fn() },
  conversation: { findUnique: vi.fn(), update: vi.fn() },
  accountContact: { findUnique: vi.fn() },
  contact: { findFirst: vi.fn() },
  optOut: { findFirst: vi.fn() },
  message: { findMany: vi.fn(), create: vi.fn() },
  setting: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));
const wa = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  isMetaConfigured: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendText: (...a: unknown[]) => wa.sendText(...a),
  sendMedia: (...a: unknown[]) => wa.sendMedia(...a),
  isMetaConfigured: (...a: unknown[]) => wa.isMetaConfigured(...a),
  describeMetaError: (e: { code?: string; message?: string }) => ({ code: e.code ?? "x", message: e.message ?? "boom" }),
}));
const limits = vi.hoisted(() => ({ chargeConversationLimit: vi.fn() }));
vi.mock("../messaging/limits", () => limits);

import { sendDesign } from "../designs/send";
import { sendDesignBodySchema } from "../schemas/documents";
import type { AgentHandlerArgs, AgentHandlerResult } from "../withAgent";

const CTX = {
  identityId: "idn-1",
  userId: "agent-user",
  credentialId: "cred-1",
  environment: "staging" as const,
  correlationId: "corr-12345678",
  ip: null,
};
const DESIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONVO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const H = 3_600_000;
const NUMBER = "FIT-CIM-2026-001";

function args<I>(input: I, params: Record<string, string> = { id: DESIGN }): AgentHandlerArgs<I> {
  return {
    ctx: CTX,
    meta: { identityName: "a", credentialLabel: "l", keyPrefix: "fvai_stg_x", expiresAt: null },
    input,
    req: new Request("https://app.test/x"),
    params,
    idempotencyKey: "idem-key-0001",
  };
}
const send = (formats: string[] = ["2d"], extra: Record<string, unknown> = {}, id = DESIGN) =>
  sendDesign(args({ formats, ...extra } as never, { id }));
const code = (r: AgentHandlerResult) => (r.body as { error: { code: string } }).error.code;
const noMessageSent = () => {
  expect(wa.sendText).not.toHaveBeenCalled();
  expect(wa.sendMedia).not.toHaveBeenCalled();
  expect(db.message.create).not.toHaveBeenCalled();
  expect(db.courtImage.update).not.toHaveBeenCalled();
};

const design = (over: Record<string, unknown> = {}) => ({
  id: DESIGN,
  number: NUMBER,
  customerName: "Rahul Verma",
  caption: null,
  imageUrl: null,
  image2dUrl: "https://blob.test/2d.png",
  image3dUrl: "https://blob.test/3d.png",
  video3dUrl: "https://blob.test/3d.mp4",
  conversationId: CONVO,
  accountContactId: LEAD,
  contactPhone: "+91 98765 43210",
  ...over,
});
const convo = (over: Record<string, unknown> = {}) => ({
  id: CONVO,
  contactPhone: "919876543210",
  lastInboundAt: new Date(Date.now() - 2 * H),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.courtImage.findUnique.mockResolvedValue(design());
  db.courtImage.update.mockResolvedValue({ id: DESIGN });
  db.conversation.findUnique.mockResolvedValue(convo());
  db.conversation.update.mockResolvedValue({ id: CONVO });
  db.accountContact.findUnique.mockResolvedValue({ phone: "98765 43210", deletedAt: null });
  db.optOut.findFirst.mockResolvedValue(null);
  db.contact.findFirst.mockResolvedValue({ allowCampaign: true });
  db.message.findMany.mockResolvedValue([]);
  db.message.create.mockResolvedValue({ id: "m" });
  limits.chargeConversationLimit.mockResolvedValue({ allowed: true });
  wa.isMetaConfigured.mockResolvedValue(true);
  let n = 0;
  wa.sendText.mockImplementation(async () => ({ waMessageId: `wamid.text${++n}` }));
  wa.sendMedia.mockImplementation(async () => ({ waMessageId: `wamid.media${++n}` }));
});

describe("send_design: sending", () => {
  it("sends the caption then each existing picture, in order, to the conversation's own number", async () => {
    const r = await send(["3d-video", "2d", "3d-image"]);
    expect(wa.sendText).toHaveBeenCalledWith({ to: "919876543210", body: `Court design ${NUMBER} from Fitoverse — Rahul Verma` });
    expect(wa.sendMedia.mock.calls.map((c) => [c[0].mediaType, c[0].url, c[0].to])).toEqual([
      ["image", "https://blob.test/2d.png", "919876543210"],
      ["image", "https://blob.test/3d.png", "919876543210"],
      ["video", "https://blob.test/3d.mp4", "919876543210"],
    ]);
    expect(r.body).toEqual({
      sent: true,
      duplicate: false,
      formatsSent: ["2d", "3d-image", "3d-video"],
      skippedDuplicateFormats: [],
      mirrored: 4,
    });
  });

  it("uses a staff-written caption when the design has one", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ caption: "  Your turf design  " }));
    await send();
    expect(wa.sendText.mock.calls[0][0].body).toBe("Your turf design");
  });

  it("saves every message into the inbox thread with the AI as sender, like the other send tools", async () => {
    await send(["2d", "3d-video"]);
    const rows = db.message.create.mock.calls.map((c) => c[0].data);
    expect(rows).toHaveLength(3);
    expect(rows.map((d) => d.type)).toEqual(["text", "image", "video"]);
    for (const d of rows) {
      expect(d).toMatchObject({ conversationId: CONVO, direction: "outbound", status: "sent", sentByUserId: "agent-user" });
      expect(d.waMessageId).toMatch(/^wamid\./);
    }
    expect(rows[1]).toMatchObject({ mediaFileName: `${NUMBER}-2d.png`, mediaMimeType: "image/png", body: `Court design ${NUMBER} sent (2d)` });
    expect(rows[2]).toMatchObject({ mediaFileName: `${NUMBER}-3d-video.mp4`, mediaMimeType: "video/mp4" });
    // last-message field only: no unread reset, no claiming the chat for the AI
    expect(db.conversation.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(db.conversation.update.mock.calls[0][0].data)).toEqual(["lastOutboundAt"]);
  });

  it("marks the design sent only when everything went out", async () => {
    await send(["2d"]);
    expect(db.courtImage.update).toHaveBeenCalledWith({
      where: { id: DESIGN },
      data: { status: "sent", sentAt: expect.any(Date) },
      select: { id: true },
    });
  });

  it("a failed inbox save does not fail a send that already reached the customer", async () => {
    db.message.create.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await send();
    expect(r.body).toMatchObject({ sent: true, mirrored: 0 });
  });

  it("charges the per-conversation hourly budget once per call and stops when it is spent", async () => {
    await send(["2d", "3d-image"]);
    expect(limits.chargeConversationLimit).toHaveBeenCalledTimes(1);
    expect(limits.chargeConversationLimit.mock.calls[0].slice(0, 2)).toEqual(["idn-1", CONVO]);
    vi.clearAllMocks();
    db.courtImage.findUnique.mockResolvedValue(design());
    db.conversation.findUnique.mockResolvedValue(convo());
    db.optOut.findFirst.mockResolvedValue(null);
    db.contact.findFirst.mockResolvedValue({ allowCampaign: true });
    db.message.findMany.mockResolvedValue([]);
    limits.chargeConversationLimit.mockResolvedValue({ allowed: false, retryAfterSec: 120, limit: 10 });
    const r = await send();
    expect(r.status).toBe(429);
    expect(code(r)).toBe("rate_limited");
    noMessageSent();
  });
});

describe("send_design: the phone is never from the request", () => {
  it("the request schema accepts formats only", () => {
    for (const extra of [{ to: "919999999999" }, { phone: "919999999999" }, { contactPhone: "919999999999" }, { conversationId: CONVO }]) {
      expect(sendDesignBodySchema.safeParse({ formats: ["2d"], ...extra }).success).toBe(false);
    }
  });

  it("even if a number reached the handler, it is ignored", async () => {
    await send(["2d"], { to: "919999999999", phone: "919999999999", contactPhone: "919999999999", conversationId: "other" });
    expect(wa.sendText.mock.calls[0][0].to).toBe("919876543210");
    expect(wa.sendMedia.mock.calls[0][0].to).toBe("919876543210");
    expect(db.conversation.findUnique.mock.calls[0][0]).toEqual({ where: { id: CONVO }, select: expect.anything() });
  });

  it("a design linked only to a CRM contact goes to that contact's number, with the window read from the chat on that number", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ conversationId: null, contactPhone: "98765 43210" }));
    db.conversation.findUnique.mockResolvedValue(convo());
    await send();
    expect(db.accountContact.findUnique.mock.calls[0][0].where).toEqual({ id: LEAD });
    expect(db.conversation.findUnique.mock.calls[0][0].where).toEqual({ contactPhone: "919876543210" });
    expect(wa.sendText.mock.calls[0][0].to).toBe("919876543210");
  });

  it("a design with a typed phone but no conversation or contact is not sent anywhere", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ conversationId: null, accountContactId: null, contactPhone: "919999999999" }));
    const r = await send();
    expect(r.status).toBe(422);
    expect(code(r)).toBe("no_customer_link");
    noMessageSent();
  });

  it("a saved phone that is not the linked customer's number is refused, not guessed at", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ contactPhone: "919999999999" }));
    const r = await send();
    expect(r.status).toBe(422);
    expect(code(r)).toBe("phone_mismatch");
    noMessageSent();
  });

  it("a linked contact with no phone, or a deleted one, has nowhere to send", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ conversationId: null, contactPhone: null }));
    db.accountContact.findUnique.mockResolvedValue({ phone: null, deletedAt: null });
    expect(code(await send())).toBe("no_phone");
    db.accountContact.findUnique.mockResolvedValue({ phone: "98765 43210", deletedAt: new Date() });
    expect(code(await send())).toBe("no_phone");
    noMessageSent();
  });
});

describe("send_design: opt-out and the 24 h window", () => {
  it("never sends to an opted-out contact", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
    const r = await send();
    expect(r.status).toBe(403);
    expect(code(r)).toBe("opted_out");
    expect(r.action).toBe("refused:opted_out");
    noMessageSent();
    // looked up under the number's spellings
    expect(db.optOut.findFirst.mock.calls[0][0].where.phoneE164.in).toContain("919876543210");
  });

  it("opt-out outranks a closed window", async () => {
    db.optOut.findFirst.mockResolvedValue({ phoneE164: "919876543210" });
    db.conversation.findUnique.mockResolvedValue(convo({ lastInboundAt: new Date(Date.now() - 30 * H) }));
    expect(code(await send())).toBe("opted_out");
    noMessageSent();
  });

  it("refuses outside the 24 hour window with window_closed", async () => {
    db.conversation.findUnique.mockResolvedValue(convo({ lastInboundAt: new Date(Date.now() - 25 * H) }));
    const r = await send();
    expect(r.status).toBe(409);
    expect(code(r)).toBe("window_closed");
    expect(r.action).toBe("refused:window_closed");
    noMessageSent();
    expect(limits.chargeConversationLimit).not.toHaveBeenCalled();
  });

  it("is window_closed when the customer never wrote to us at all", async () => {
    db.conversation.findUnique.mockResolvedValue(convo({ lastInboundAt: null }));
    expect(code(await send())).toBe("window_closed");
    db.courtImage.findUnique.mockResolvedValue(design({ conversationId: null }));
    db.conversation.findUnique.mockResolvedValue(null);
    expect(code(await send())).toBe("window_closed");
    noMessageSent();
  });

  it("stays open just inside 24 hours", async () => {
    db.conversation.findUnique.mockResolvedValue(convo({ lastInboundAt: new Date(Date.now() - 23.9 * H) }));
    expect((await send()).body).toMatchObject({ sent: true });
  });
});

describe("send_design: only what exists", () => {
  it("refuses a format with no picture and sends nothing at all", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ image3dUrl: null }));
    const r = await send(["2d", "3d-image"]);
    expect(r.status).toBe(422);
    expect(code(r)).toBe("format_missing");
    expect((r.body as { error: { message: string } }).error.message).toContain("3d-image");
    noMessageSent();
  });

  it("an empty draft has nothing to send", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ image2dUrl: null, image3dUrl: null, video3dUrl: null }));
    expect(code(await send(["2d"]))).toBe("format_missing");
    noMessageSent();
  });

  it("the primary imageUrl serves as the 2D plan", async () => {
    db.courtImage.findUnique.mockResolvedValue(design({ image2dUrl: null, imageUrl: "https://blob.test/primary.png" }));
    await send(["2d"]);
    expect(wa.sendMedia.mock.calls[0][0].url).toBe("https://blob.test/primary.png");
  });

  it("404s on an unknown design and never queries a malformed id", async () => {
    db.courtImage.findUnique.mockResolvedValue(null);
    await expect(send()).rejects.toMatchObject({ code: "not_found" });
    db.courtImage.findUnique.mockClear();
    await expect(send(["2d"], {}, "nope")).rejects.toMatchObject({ code: "not_found" });
    expect(db.courtImage.findUnique).not.toHaveBeenCalled();
  });
});

describe("send_design: repeats and failures", () => {
  it("skips a picture already sent to this chat in the last 10 minutes, and says so", async () => {
    db.message.findMany.mockResolvedValue([{ mediaFileName: `${NUMBER}-2d.png` }]);
    const r = await send(["2d", "3d-image"]);
    expect(wa.sendMedia).toHaveBeenCalledTimes(1);
    expect(wa.sendMedia.mock.calls[0][0].url).toBe("https://blob.test/3d.png");
    expect(r.body).toMatchObject({ sent: true, formatsSent: ["3d-image"], skippedDuplicateFormats: ["2d"] });
    const where = db.message.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ conversationId: CONVO, direction: "outbound", mediaFileName: { startsWith: `${NUMBER}-` } });
  });

  it("sends nothing when every requested picture was just sent", async () => {
    db.message.findMany.mockResolvedValue([{ mediaFileName: `${NUMBER}-2d.png` }]);
    const r = await send(["2d"]);
    expect(r.body).toMatchObject({ sent: false, duplicate: true, skippedDuplicateFormats: ["2d"] });
    noMessageSent();
    expect(limits.chargeConversationLimit).not.toHaveBeenCalled();
  });

  it("WhatsApp not configured is a 503, nothing sent", async () => {
    wa.isMetaConfigured.mockResolvedValue(false);
    await expect(send()).rejects.toMatchObject({ status: 503 });
    noMessageSent();
  });

  it("a timeout on the first message is 'delivery unknown', a rejection is a 502 that can be retried", async () => {
    wa.sendText.mockRejectedValueOnce({ code: "timeout" });
    const r = await send();
    expect(r.status).toBe(409);
    expect(code(r)).toBe("delivery_unknown");
    wa.sendText.mockRejectedValueOnce({ code: "131047", message: "re-engagement" });
    await expect(send()).rejects.toMatchObject({ code: "internal", status: 502 });
    expect(wa.sendMedia).not.toHaveBeenCalled();
    expect(db.courtImage.update).not.toHaveBeenCalled();
  });

  it("a picture that fails after the caption went out is a final 'incomplete' answer: the part that was delivered is saved, the design is not marked sent", async () => {
    wa.sendMedia.mockImplementationOnce(async () => ({ waMessageId: "wamid.m1" })).mockRejectedValueOnce({ code: "131053", message: "media upload" });
    const r = await send(["2d", "3d-image", "3d-video"]);
    expect(r.status).toBe(409);
    expect(code(r)).toBe("delivery_incomplete");
    const message = (r.body as { error: { message: string } }).error.message;
    expect(message).toContain("3d-image");
    expect(message).toContain("2d");
    expect(db.message.create.mock.calls.map((c) => c[0].data.type)).toEqual(["text", "image"]);
    expect(wa.sendMedia).toHaveBeenCalledTimes(2);
    expect(db.courtImage.update).not.toHaveBeenCalled();
  });
});
