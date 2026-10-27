import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  websiteLead: { create: vi.fn() },
  metaLeadStage: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  setting: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/scout/after", () => ({ after: (w: () => unknown) => void Promise.resolve(w()) }));

import { POST } from "@/app/api/website-leads/incoming/route";
import { generateWebsiteLeadKey, hashWebsiteLeadKey } from "../key";

const key = generateWebsiteLeadKey();
const lead = {
  id: "6f1f3a52-0e0b-4c8e-9b57-1f2a3b4c5d6e",
  name: "Asha Rao",
  phone: "+919876543210",
  city: "Pune",
  sport: "Football",
  source: "fitoverse.com/build",
};

const call = (query: string, body: unknown) =>
  POST(
    new NextRequest(`http://crm.test/api/website-leads/incoming${query}`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.setting.findUnique.mockResolvedValue({ value: hashWebsiteLeadKey(key) });
  db.metaLeadStage.findFirst.mockResolvedValue({ slug: "NEW" });
  db.user.findMany.mockResolvedValue([]);
  db.websiteLead.create.mockResolvedValue({ id: "our-uuid-1", name: "Asha Rao", city: "Pune", sport: "Football" });
});

describe("POST /api/website-leads/incoming", () => {
  it("401 with no key", async () => {
    const res = await call("", lead);
    expect(res.status).toBe(401);
    expect(db.websiteLead.create).not.toHaveBeenCalled();
  });

  it("401 with a wrong key", async () => {
    const res = await call(`?key=${generateWebsiteLeadKey()}`, lead);
    expect(res.status).toBe(401);
    expect(db.websiteLead.create).not.toHaveBeenCalled();
  });

  it("401 when no secret has been issued", async () => {
    db.setting.findUnique.mockResolvedValue(null);
    expect((await call(`?key=${key}`, lead)).status).toBe(401);
  });

  it("200 { ok: true } with the right key, and the lead is saved", async () => {
    const res = await call(`?key=${key}`, lead);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.websiteLead.create).toHaveBeenCalledTimes(1);
  });

  it("a repeat of the same lead id is still 200", async () => {
    db.websiteLead.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const res = await call(`?key=${key}`, lead);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("a lead from a preview site is 200 but not saved", async () => {
    const res = await call(`?key=${key}`, { ...lead, source: "preview-abc.vercel.app/build" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
    expect(db.websiteLead.create).not.toHaveBeenCalled();
  });

  it("400 for broken JSON or an incomplete lead", async () => {
    expect((await call(`?key=${key}`, "{nope")).status).toBe(400);
    expect((await call(`?key=${key}`, { ...lead, phone: "" })).status).toBe(400);
  });
});
