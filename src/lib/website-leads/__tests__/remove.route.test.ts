import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Any model the route touches is recorded, and every model offers updateMany only:
// removing / restoring a lead can change nothing but WebsiteLead.deletedAt.
const h = vi.hoisted(() => {
  const updateMany = vi.fn();
  const models: string[] = [];
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      models.push(name);
      return { updateMany };
    },
  });
  return { updateMany, models, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth", () => auth);

import { POST } from "@/app/api/website-leads/remove/route";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IDS = [uuid(1), uuid(2), uuid(3)];
const NOW = new Date("2026-10-27T10:00:00.000Z");

const call = (body: unknown) =>
  POST(
    new NextRequest("http://crm.test/api/website-leads/remove", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.models.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  auth.getCurrentUser.mockResolvedValue({ id: "u1", role: "admin" });
  h.updateMany.mockResolvedValue({ count: 3 });
});
afterEach(() => vi.useRealTimers());

describe("POST /api/website-leads/remove: who may", () => {
  it("401 when signed out", async () => {
    auth.getCurrentUser.mockResolvedValue(null);
    expect((await call({ ids: IDS, action: "remove" })).status).toBe(401);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it.each(["sales", "management"])("403 for %s, in both directions, and nothing is written", async (role) => {
    auth.getCurrentUser.mockResolvedValue({ id: "u2", role });
    for (const action of ["remove", "restore"]) {
      const res = await call({ ids: IDS, action });
      expect(res.status).toBe(403);
    }
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it.each(["admin", "manager"])("%s may remove and restore", async (role) => {
    auth.getCurrentUser.mockResolvedValue({ id: "u3", role });
    expect((await call({ ids: IDS, action: "remove" })).status).toBe(200);
    expect((await call({ ids: IDS, action: "restore" })).status).toBe(200);
    expect(h.updateMany).toHaveBeenCalledTimes(2);
  });

  it("checks the role before reading the body", async () => {
    auth.getCurrentUser.mockResolvedValue({ id: "u2", role: "sales" });
    expect((await call("not json")).status).toBe(403);
  });
});

describe("POST /api/website-leads/remove: body", () => {
  it.each([
    ["not json", "not json"],
    ["no body fields", {}],
    ["no ids", { action: "remove" }],
    ["no action", { ids: IDS }],
    ["empty ids", { ids: [], action: "remove" }],
    ["501 ids", { ids: Array.from({ length: 501 }, (_, i) => uuid(i + 1)), action: "remove" }],
    ["an id that is not a uuid", { ids: ["abc"], action: "remove" }],
    ["ids that are not strings", { ids: [1], action: "remove" }],
    ["an unknown action", { ids: IDS, action: "delete" }],
    ["the old leadIds name", { leadIds: IDS, action: "remove" }],
  ])("400 for %s", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_payload" });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("accepts one id and exactly 500", async () => {
    expect((await call({ ids: [uuid(1)], action: "remove" })).status).toBe(200);
    expect((await call({ ids: Array.from({ length: 500 }, (_, i) => uuid(i + 1)), action: "restore" })).status).toBe(200);
  });
});

describe("POST /api/website-leads/remove: what it writes", () => {
  it("remove sets deletedAt = now on the leads that are not removed yet, and reports how many changed", async () => {
    h.updateMany.mockResolvedValue({ count: 2 }); // one of the three was already removed
    const res = await call({ ids: IDS, action: "remove" });
    expect(await res.json()).toEqual({ ok: true, changed: 2 });
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: { in: IDS }, deletedAt: null },
      data: { deletedAt: NOW },
    });
  });

  it("restore clears deletedAt on the removed leads only, and reports how many changed", async () => {
    h.updateMany.mockResolvedValue({ count: 1 });
    const res = await call({ ids: IDS, action: "restore" });
    expect(await res.json()).toEqual({ ok: true, changed: 1 });
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: { in: IDS }, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  });

  it("changed is 0 when every lead was already in that state", async () => {
    h.updateMany.mockResolvedValue({ count: 0 });
    expect(await (await call({ ids: IDS, action: "remove" })).json()).toEqual({ ok: true, changed: 0 });
  });

  it("touches only the website lead table: no CRM contact, marketing contact or group membership", async () => {
    await call({ ids: IDS, action: "remove" });
    await call({ ids: IDS, action: "restore" });
    expect([...new Set(h.models)]).toEqual(["websiteLead"]);
  });
});
