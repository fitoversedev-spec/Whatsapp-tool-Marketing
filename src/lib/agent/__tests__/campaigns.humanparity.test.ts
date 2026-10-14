import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The broadcast logic was moved into src/lib/broadcasts so the AI agent's tools
 * share it with the human routes. These tests pin the human routes' behaviour:
 * the same status codes and the same error text as before.
 */
const db = vi.hoisted(() => ({
  template: { findUnique: vi.fn() },
  broadcastGroup: { findUnique: vi.fn() },
  broadcast: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
const sender = vi.hoisted(() => ({ prepareBroadcast: vi.fn() }));
vi.mock("@/lib/sender", () => sender);
const chain = vi.hoisted(() => ({ sendInBackground: vi.fn() }));
vi.mock("@/lib/broadcast-chain", () => chain);

import { NextRequest } from "next/server";
import { createBroadcastRecord } from "@/lib/broadcasts/create";
import { requestBroadcastPause, startBroadcast } from "@/lib/broadcasts/control";
import { scheduleWindowError } from "@/lib/broadcasts/schedule";
import { POST as createRoute } from "@/app/api/broadcasts/route";
import { POST as launchRoute } from "@/app/api/broadcasts/[id]/launch/route";
import { POST as pauseRoute } from "@/app/api/broadcasts/[id]/pause/route";
import { PATCH as reschedulePatch } from "@/app/api/broadcasts/[id]/schedule/route";

const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";
const BC = "33333333-3333-4333-8333-333333333333";
const USER = { id: "user-1", role: "sales" };

const base = {
  name: "Diwali",
  sourceType: "contacts" as const,
  templateId: TEMPLATE,
  variableMapping: { "1": "name" },
  createdByUserId: "user-1",
};
const MIN = 60_000;
const DAY = 86_400_000;

beforeEach(() => {
  vi.clearAllMocks();
  auth.getCurrentUser.mockResolvedValue(USER);
  db.template.findUnique.mockResolvedValue({ id: TEMPLATE, status: "approved", deletedAt: null });
  db.broadcast.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: BC,
    status: data.status,
    scheduledAt: data.scheduledAt ?? null,
  }));
  db.broadcast.update.mockResolvedValue({ id: BC });
  sender.prepareBroadcast.mockResolvedValue({ total: 7 });
});

describe("createBroadcastRecord (POST /api/broadcasts)", () => {
  it("rejects a template that is not approved and active", async () => {
    for (const t of [null, { status: "pending", deletedAt: null }, { status: "approved", deletedAt: new Date() }]) {
      db.template.findUnique.mockResolvedValue(t);
      await expect(createBroadcastRecord(base)).resolves.toEqual({ ok: false, status: 422, error: "Template must be approved and active" });
    }
  });

  it("checks the source has what it needs", async () => {
    await expect(createBroadcastRecord({ ...base, sourceType: "file" })).resolves.toEqual({ ok: false, status: 400, error: "File data is required" });
    await expect(createBroadcastRecord({ ...base, sourceType: "sheet", sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit" })).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Sheet URL and range are required",
    });
  });

  it("checks a group exists and has members", async () => {
    db.broadcastGroup.findUnique.mockResolvedValue(null);
    await expect(createBroadcastRecord({ ...base, groupId: GROUP })).resolves.toEqual({ ok: false, status: 404, error: "This group no longer exists" });
    db.broadcastGroup.findUnique.mockResolvedValue({ name: "G", _count: { members: 0 } });
    await expect(createBroadcastRecord({ ...base, groupId: GROUP })).resolves.toEqual({ ok: false, status: 422, error: "This group has no members yet" });
  });

  it("stores a group by id (read when the broadcast sends) and the picked contacts otherwise", async () => {
    db.broadcastGroup.findUnique.mockResolvedValue({ name: "Goa", _count: { members: 3 } });
    await createBroadcastRecord({ ...base, groupId: GROUP, selectedContactIds: ["x"] });
    const grouped = JSON.parse(db.broadcast.create.mock.calls[0][0].data.variableMapping);
    expect(grouped).toMatchObject({ groupId: GROUP, groupName: "Goa", selectedContactIds: null, filterRules: [] });
    await createBroadcastRecord({ ...base, selectedContactIds: ["a", "b"], extraMapping: { agent: { recipientCount: 2 } } });
    const picked = JSON.parse(db.broadcast.create.mock.calls[1][0].data.variableMapping);
    expect(picked).toMatchObject({ groupId: null, selectedContactIds: ["a", "b"], agent: { recipientCount: 2 } });
  });

  it("holds the schedule to 2 minutes .. 90 days, and saves a scheduled one as 'scheduled'", async () => {
    const soon = await createBroadcastRecord({ ...base, scheduledAt: new Date(Date.now() + MIN).toISOString() });
    expect(soon).toEqual({ ok: false, status: 422, error: "Scheduled time must be at least 2 minutes in the future" });
    const far = await createBroadcastRecord({ ...base, scheduledAt: new Date(Date.now() + 91 * DAY).toISOString() });
    expect(far).toEqual({ ok: false, status: 422, error: "Scheduled time must be within 90 days" });
    const at = new Date(Date.now() + DAY).toISOString();
    const ok = await createBroadcastRecord({ ...base, scheduledAt: at });
    expect(ok).toMatchObject({ ok: true, broadcast: { id: BC, status: "scheduled", scheduledAt: at } });
    const draft = await createBroadcastRecord(base);
    expect(draft).toMatchObject({ ok: true, broadcast: { status: "draft", scheduledAt: null } });
  });

  it("the route maps it to the same responses as before", async () => {
    const post = (body: unknown) =>
      createRoute(new NextRequest("https://app.test/api/broadcasts", { method: "POST", body: JSON.stringify(body) }));
    const valid = { name: "n", sourceType: "contacts", templateId: TEMPLATE, variableMapping: { "1": "name" } };

    auth.getCurrentUser.mockResolvedValueOnce(null);
    expect((await post(valid)).status).toBe(401);
    expect((await post({ name: "" })).status).toBe(400);
    const ok = await post(valid);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ broadcast: { id: BC, status: "draft", scheduledAt: null } });
    expect(db.broadcast.create.mock.calls[0][0].data.createdByUserId).toBe("user-1");
    db.template.findUnique.mockResolvedValue(null);
    const bad = await post(valid);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "Template must be approved and active" });
  });
});

describe("scheduleWindowError (PATCH /api/broadcasts/[id]/schedule)", () => {
  it("is the same window", () => {
    const now = Date.now();
    expect(scheduleWindowError(new Date(now + 119_000), now)).toBe("Scheduled time must be at least 2 minutes in the future");
    expect(scheduleWindowError(new Date(now + 121_000), now)).toBeNull();
    expect(scheduleWindowError(new Date(now + 90 * DAY - 1000), now)).toBeNull();
    expect(scheduleWindowError(new Date(now + 90 * DAY + 1000), now)).toBe("Scheduled time must be within 90 days");
  });

  it("the route still reschedules a scheduled broadcast and refuses a bad time", async () => {
    db.broadcast.findUnique.mockResolvedValue({ status: "scheduled", createdByUserId: "user-1" });
    const patch = (scheduledAt: string) =>
      reschedulePatch(new NextRequest("https://app.test/x", { method: "PATCH", body: JSON.stringify({ scheduledAt }) }), { params: { id: BC } });
    const bad = await patch(new Date(Date.now() + MIN).toISOString());
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "Scheduled time must be at least 2 minutes in the future" });
    const at = new Date(Date.now() + DAY);
    db.broadcast.update.mockResolvedValue({ scheduledAt: at });
    const ok = await patch(at.toISOString());
    expect(await ok.json()).toEqual({ ok: true, scheduledAt: at.toISOString() });
  });
});

describe("startBroadcast (POST /api/broadcasts/[id]/launch)", () => {
  it("claims a draft or scheduled broadcast atomically, builds the list, and starts sending", async () => {
    db.broadcast.updateMany.mockResolvedValue({ count: 1 });
    const r = await startBroadcast(BC, "https://app.test");
    expect(r).toEqual({ kind: "started", total: 7 });
    expect(db.broadcast.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: BC, status: { in: ["draft", "scheduled"] } },
      data: { status: "running" },
    });
    expect(sender.prepareBroadcast).toHaveBeenCalledWith(BC);
    expect(chain.sendInBackground).toHaveBeenCalledWith("https://app.test", BC);
  });

  it("turns away a second launch without sending again", async () => {
    db.broadcast.updateMany.mockResolvedValue({ count: 0 });
    expect(await startBroadcast(BC, "https://app.test")).toEqual({ kind: "not_launchable" });
    expect(sender.prepareBroadcast).not.toHaveBeenCalled();
    expect(chain.sendInBackground).not.toHaveBeenCalled();
  });

  it("marks the broadcast failed when the list cannot be built", async () => {
    db.broadcast.updateMany.mockResolvedValue({ count: 1 });
    const boom = new Error("sheet unreadable");
    sender.prepareBroadcast.mockRejectedValue(boom);
    expect(await startBroadcast(BC, "https://app.test")).toEqual({ kind: "failed", error: boom });
    expect(db.broadcast.update).toHaveBeenCalledWith({ where: { id: BC }, data: { status: "failed" }, select: { id: true } });
    expect(chain.sendInBackground).not.toHaveBeenCalled();
  });

  it("a verifier that says no stops the send and marks it failed", async () => {
    db.broadcast.updateMany.mockResolvedValue({ count: 1 });
    const r = await startBroadcast(BC, "https://app.test", { verifyTotal: async () => false });
    expect(r).toEqual({ kind: "over_limit", total: 7 });
    expect(chain.sendInBackground).not.toHaveBeenCalled();
    expect(db.broadcast.update.mock.calls[0][0].data).toEqual({ status: "failed" });
  });

  describe("the human launch route", () => {
    const launch = () => launchRoute(new Request("https://app.test/api/broadcasts/x/launch", { method: "POST" }), { params: { id: BC } });
    beforeEach(() => db.broadcast.findUnique.mockResolvedValue({ status: "draft", createdByUserId: "user-1" }));

    it("answers as before on success", async () => {
      db.broadcast.updateMany.mockResolvedValue({ count: 1 });
      const r = await launch();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, status: "running", total: 7 });
      expect(chain.sendInBackground).toHaveBeenCalledWith("https://app.test", BC);
    });

    it("says 'Already launched' for a draft that was claimed, and the status otherwise", async () => {
      db.broadcast.updateMany.mockResolvedValue({ count: 0 });
      let r = await launch();
      expect(r.status).toBe(422);
      expect(await r.json()).toEqual({ error: "Already launched" });
      db.broadcast.findUnique.mockResolvedValue({ status: "completed", createdByUserId: "user-1" });
      r = await launch();
      expect(await r.json()).toEqual({ error: "Already completed" });
    });

    it("answers 500 broadcast_failed with the reason when the list cannot be built", async () => {
      db.broadcast.updateMany.mockResolvedValue({ count: 1 });
      sender.prepareBroadcast.mockRejectedValue(new Error("sheet unreadable"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const r = await launch();
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: "broadcast_failed", message: "sheet unreadable" });
    });

    it("keeps the sign-in and ownership checks", async () => {
      auth.getCurrentUser.mockResolvedValueOnce(null);
      expect((await launch()).status).toBe(401);
      db.broadcast.findUnique.mockResolvedValue(null);
      expect((await launch()).status).toBe(404);
      db.broadcast.findUnique.mockResolvedValue({ status: "draft", createdByUserId: "someone-else" });
      expect((await launch()).status).toBe(403);
      expect(db.broadcast.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe("requestBroadcastPause (POST /api/broadcasts/[id]/pause)", () => {
  it("only a running broadcast can be paused", async () => {
    await expect(requestBroadcastPause(BC, "draft")).resolves.toEqual({ ok: false, error: "Cannot pause a draft broadcast" });
    expect(db.broadcast.update).not.toHaveBeenCalled();
    const r = await requestBroadcastPause(BC, "running");
    expect(r.ok).toBe(true);
    expect(db.broadcast.update.mock.calls[0][0]).toMatchObject({ where: { id: BC }, data: { pauseRequestedAt: expect.any(Date) } });
  });

  it("the route answers as before", async () => {
    const pause = () => pauseRoute(new Request("https://app.test/x", { method: "POST" }), { params: { id: BC } });
    db.broadcast.findUnique.mockResolvedValue({ status: "completed", createdByUserId: "user-1" });
    const no = await pause();
    expect(no.status).toBe(422);
    expect(await no.json()).toEqual({ error: "Cannot pause a completed broadcast" });
    db.broadcast.findUnique.mockResolvedValue({ status: "running", createdByUserId: "user-1" });
    const yes = await pause();
    expect(yes.status).toBe(200);
    expect(await yes.json()).toMatchObject({ ok: true, pauseRequestedAt: expect.any(String) });
  });
});
