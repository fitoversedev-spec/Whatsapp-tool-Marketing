import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Court-design creation and sending were moved into src/lib/court-image so the
 * AI agent's tools share them with the human routes. These tests pin the human
 * routes' behaviour.
 */
const db = vi.hoisted(() => ({
  courtImage: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  message: { create: vi.fn() },
  conversation: { update: vi.fn() },
  deal: { update: vi.fn(), findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
const wa = vi.hoisted(() => ({ sendText: vi.fn(), sendMedia: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({
  sendText: (...a: unknown[]) => wa.sendText(...a),
  sendMedia: (...a: unknown[]) => wa.sendMedia(...a),
  describeMetaError: (e: { code?: string; message?: string }) => ({ code: e.code ?? "x", message: e.message ?? "boom" }),
}));
const delivery = vi.hoisted(() => ({ resolveWhatsAppDelivery: vi.fn() }));
vi.mock("@/lib/whatsapp-delivery", () => delivery);
const links = vi.hoisted(() => ({
  resolveContactForDocument: vi.fn(),
  applyDocumentClassification: vi.fn(),
  logDocumentDeleted: vi.fn(),
}));
vi.mock("@/lib/crm/contactLinks", () => links);

import { NextRequest } from "next/server";
import { POST as createRoute } from "@/app/api/court-images/route";
import { POST as sendRoute } from "@/app/api/court-images/[id]/send/route";
import { createCourtImageRow } from "@/lib/court-image/create";
import { buildDesignSendItems, designCaption, designFormatUrl, designMirrorMedia, existingDesignFormats } from "@/lib/court-image/send";

const YEAR = new Date().getFullYear();
const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = { id: "user-1", role: "sales" };
const layout = { v: 1, plot: { lengthFt: 100, widthFt: 60 }, sports: ["football"], elements: [], style: {} };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getCurrentUser.mockResolvedValue(USER);
  links.resolveContactForDocument.mockResolvedValue(null);
  db.courtImage.findFirst.mockResolvedValue(null);
  db.courtImage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: ID, ...data }));
});

describe("createCourtImageRow (POST /api/court-images)", () => {
  it("numbers the first design of the year 001 and the next one after the highest existing", async () => {
    const row = await createCourtImageRow({ customerName: "A", layout: "{}", createdByUserId: "u" });
    expect(row?.number).toBe(`FIT-CIM-${YEAR}-001`);
    db.courtImage.findFirst.mockResolvedValue({ number: `FIT-CIM-${YEAR}-007` });
    const next = await createCourtImageRow({ customerName: "A", layout: "{}", createdByUserId: "u" });
    expect(next?.number).toBe(`FIT-CIM-${YEAR}-008`);
    expect(db.courtImage.findFirst.mock.calls[0][0].where).toEqual({ number: { startsWith: `FIT-CIM-${YEAR}-` } });
  });

  it("retries a number collision with the next number, and gives up with null after 6", async () => {
    db.courtImage.create.mockRejectedValueOnce({ code: "P2002" }).mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ id: ID, ...data }));
    const row = await createCourtImageRow({ customerName: "A", layout: "{}", createdByUserId: "u" });
    expect(row?.number).toBe(`FIT-CIM-${YEAR}-002`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.courtImage.create.mockReset();
    db.courtImage.create.mockRejectedValue({ code: "P2002" });
    expect(await createCourtImageRow({ customerName: "A", layout: "{}", createdByUserId: "u" })).toBeNull();
    expect(db.courtImage.create).toHaveBeenCalledTimes(6);
  });

  it("any other error is thrown", async () => {
    db.courtImage.create.mockRejectedValue(new Error("db down"));
    await expect(createCourtImageRow({ customerName: "A", layout: "{}", createdByUserId: "u" })).rejects.toThrow("db down");
  });

  it("always starts as a draft, with the pictures it was given", async () => {
    await createCourtImageRow({ customerName: "A", layout: "L", createdByUserId: "u", image2dUrl: "https://x.test/a.png", conversationId: "c", contactPhone: "p", accountContactId: "ac" });
    expect(db.courtImage.create.mock.calls[0][0].data).toMatchObject({
      status: "draft",
      layout: "L",
      imageUrl: null,
      image2dUrl: "https://x.test/a.png",
      image3dUrl: null,
      video3dUrl: null,
      conversationId: "c",
      contactPhone: "p",
      accountContactId: "ac",
      dealId: null,
      createdByUserId: "u",
    });
  });

  it("the route answers as before", async () => {
    const post = (body: unknown) =>
      createRoute(new NextRequest("https://app.test/api/court-images", { method: "POST", body: JSON.stringify(body) }));
    const r = await post({ customerName: "Rahul", layout, imageUrl: "https://x.test/p.png" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ courtImage: { id: ID, number: `FIT-CIM-${YEAR}-001`, status: "draft" } });
    expect(db.courtImage.create.mock.calls[0][0].data).toMatchObject({
      createdByUserId: "user-1",
      imageUrl: "https://x.test/p.png",
      layout: JSON.stringify(layout),
    });

    expect((await post({ customerName: "" })).status).toBe(400);
    auth.getCurrentUser.mockResolvedValueOnce(null);
    expect((await post({ customerName: "x", layout })).status).toBe(401);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.courtImage.create.mockReset();
    db.courtImage.create.mockRejectedValue({ code: "P2002" });
    const busy = await post({ customerName: "Rahul", layout });
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: "Could not assign a unique design number after retries. Try again in a moment." });
  });
});

describe("shared send helpers", () => {
  const row = { imageUrl: "p", image2dUrl: null, image3dUrl: "i3", video3dUrl: "v3" };

  it("formats come out in order 2d, 3d-image, 3d-video, whatever order they were asked in", () => {
    const built = buildDesignSendItems(row, ["3d-video", "2d", "3d-image"]);
    expect(built).toEqual({
      ok: true,
      items: [
        { format: "2d", url: "p", mediaType: "image", fileExt: "png" },
        { format: "3d-image", url: "i3", mediaType: "image", fileExt: "png" },
        { format: "3d-video", url: "v3", mediaType: "video", fileExt: "mp4" },
      ],
    });
    expect(buildDesignSendItems({ ...row, image3dUrl: null }, ["2d", "3d-image"])).toEqual({ ok: false, missing: "3d-image" });
  });

  it("knows which formats exist, with the primary image standing in for the 2D plan", () => {
    expect(existingDesignFormats(row)).toEqual(["2d", "3d-image", "3d-video"]);
    expect(existingDesignFormats({ imageUrl: null, image2dUrl: null, image3dUrl: null, video3dUrl: null })).toEqual([]);
    expect(designFormatUrl({ ...row, image2dUrl: "two" }, "2d")).toBe("two");
  });

  it("caption and inbox record are what the human route always wrote", () => {
    expect(designCaption({ caption: null, number: "N-1", customerName: "Rahul" })).toBe("Court design N-1 from Fitoverse — Rahul");
    expect(designCaption({ caption: " Hi ", number: "N-1", customerName: "Rahul" })).toBe("Hi");
    expect(designMirrorMedia({ number: "N-1" }, { format: "3d-video", url: "u", isVideo: true })).toEqual({
      type: "video",
      body: "Court design N-1 sent (3d-video)",
      mediaUrl: "u",
      mediaMimeType: "video/mp4",
      mediaFileName: "N-1-3d-video.mp4",
    });
    expect(designMirrorMedia({ number: "N-1" }, { format: "2d", url: "u", isVideo: false })).toMatchObject({
      type: "image",
      mediaMimeType: "image/png",
      mediaFileName: "N-1-2d.png",
    });
  });
});

describe("the human send route (POST /api/court-images/[id]/send)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: ID,
    number: "N-1",
    customerName: "Rahul",
    caption: null,
    imageUrl: null,
    image2dUrl: "https://x.test/2d.png",
    image3dUrl: null,
    video3dUrl: "https://x.test/v.mp4",
    contactPhone: "+91 98765 43210",
    conversationId: null,
    createdByUserId: "user-1",
    ...over,
  });
  const post = (body: unknown) =>
    sendRoute(new NextRequest("https://app.test/x", { method: "POST", body: JSON.stringify(body) }), { params: { id: ID } });

  beforeEach(() => {
    db.courtImage.findUnique.mockResolvedValue(row());
    db.courtImage.update.mockResolvedValue({});
    db.message.create.mockResolvedValue({});
    db.conversation.update.mockResolvedValue({});
    delivery.resolveWhatsAppDelivery.mockResolvedValue({ mode: "cloud-api", conversationId: "convo-1", normalizedPhone: "919876543210" });
    let n = 0;
    wa.sendText.mockImplementation(async () => ({ waMessageId: `t${++n}` }));
    wa.sendMedia.mockImplementation(async () => ({ waMessageId: `m${++n}` }));
  });

  it("sends the caption then the pictures in order, mirrors them as the signed-in user, and marks the design sent", async () => {
    const r = await post({ formats: ["3d-video", "2d"] });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.sent.map((s: { format: string }) => s.format)).toEqual(["caption", "2d", "3d-video"]);
    expect(wa.sendText).toHaveBeenCalledWith({ to: "919876543210", body: "Court design N-1 from Fitoverse — Rahul" });
    expect(wa.sendMedia.mock.calls.map((c) => c[0])).toEqual([
      { to: "919876543210", mediaType: "image", url: "https://x.test/2d.png" },
      { to: "919876543210", mediaType: "video", url: "https://x.test/v.mp4" },
    ]);
    const msgs = db.message.create.mock.calls.map((c) => c[0].data);
    expect(msgs[1]).toEqual({
      conversationId: "convo-1",
      direction: "outbound",
      type: "image",
      body: "Court design N-1 sent (2d)",
      mediaUrl: "https://x.test/2d.png",
      mediaMimeType: "image/png",
      mediaFileName: "N-1-2d.png",
      waMessageId: "m2",
      status: "sent",
      sentByUserId: "user-1",
    });
    expect(msgs[2]).toMatchObject({ type: "video", mediaFileName: "N-1-3d-video.mp4", mediaMimeType: "video/mp4" });
    expect(db.courtImage.update).toHaveBeenCalledWith({ where: { id: ID }, data: { status: "sent", sentAt: expect.any(Date) } });
  });

  it("falls back to the primary image when no formats are given", async () => {
    db.courtImage.findUnique.mockResolvedValue(row({ image2dUrl: null, imageUrl: "https://x.test/p.png" }));
    const r = await post({});
    expect((await r.json()).sent.map((s: { format: string }) => s.format)).toEqual(["caption", "2d"]);
    expect(wa.sendMedia.mock.calls[0][0].url).toBe("https://x.test/p.png");
  });

  it("422 missing_url for a picture that was never saved, before anything is sent", async () => {
    const r = await post({ formats: ["2d", "3d-image"] });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "missing_url", message: "No 3d-image media saved for this design — regenerate it in the wizard." });
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it("hands off to WhatsApp Web with links when there is no open session", async () => {
    delivery.resolveWhatsAppDelivery.mockResolvedValue({ mode: "whatsapp-web", conversationId: null, normalizedPhone: "919876543210" });
    const r = await post({ formats: ["2d"] });
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.sent).toEqual([]);
    expect(body.whatsappWebUrl).toContain("https://api.whatsapp.com/send/?phone=919876543210");
    expect(wa.sendText).not.toHaveBeenCalled();
  });

  it("keeps its checks: sign-in, owner, phone and format choice", async () => {
    auth.getCurrentUser.mockResolvedValueOnce(null);
    expect((await post({})).status).toBe(401);
    db.courtImage.findUnique.mockResolvedValue(null);
    expect((await post({})).status).toBe(404);
    db.courtImage.findUnique.mockResolvedValue(row({ createdByUserId: "other" }));
    expect((await post({})).status).toBe(403);
    db.courtImage.findUnique.mockResolvedValue(row({ contactPhone: null }));
    expect((await post({})).status).toBe(422);
    db.courtImage.findUnique.mockResolvedValue(row({ image2dUrl: null, imageUrl: null }));
    const none = await post({});
    expect(none.status).toBe(422);
    expect((await none.json()).error).toBe("no_formats");
  });
});
