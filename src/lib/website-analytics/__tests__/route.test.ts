import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth", () => auth);

const lib = vi.hoisted(() => ({ getAnalytics: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/website-analytics", async (orig) => ({
  ...(await orig<typeof import("@/lib/website-analytics")>()),
  getAnalytics: lib.getAnalytics,
}));

import { GET } from "@/app/api/website-leads/analytics/route";

const get = (query: string) => GET(new NextRequest(`http://crm.test/api/website-leads/analytics${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  auth.getCurrentUser.mockResolvedValue({ id: "u1", role: "sales" });
  lib.getAnalytics.mockResolvedValue({ ok: true, connected: false, section: "overview", missing: ["GA4_PROPERTY_ID"] });
});

describe("GET /api/website-leads/analytics", () => {
  it("401 when signed out, without touching Google or the database", async () => {
    auth.getCurrentUser.mockResolvedValue(null);
    const res = await get("?section=overview");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(lib.getAnalytics).not.toHaveBeenCalled();
  });

  it("any signed-in role may read it", async () => {
    for (const role of ["admin", "manager", "sales"]) {
      auth.getCurrentUser.mockResolvedValue({ id: "u", role });
      expect((await get("?section=overview")).status).toBe(200);
    }
  });

  it("400 for a missing or unknown section", async () => {
    for (const q of ["", "?section=", "?section=revenue", "?section=Overview"]) {
      const res = await get(q);
      expect(res.status, q).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "Unknown section." });
    }
    expect(lib.getAnalytics).not.toHaveBeenCalled();
  });

  it("400 for a bad range", async () => {
    for (const q of [
      "?section=overview&range=90d",
      "?section=overview&range=custom",
      "?section=overview&range=custom&from=2026-10-10",
      "?section=overview&range=custom&from=2026-10-10&to=2026-02-30",
      "?section=overview&range=custom&from=2026-10-12&to=2026-10-10",
      "?section=overview&range=custom&from=2026-10-01&to=2099-01-01",
      "?section=overview&range=custom&from=2001-01-01&to=2001-02-01",
    ]) {
      const res = await get(q);
      expect(res.status, q).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, error: expect.any(String) });
    }
    expect(lib.getAnalytics).not.toHaveBeenCalled();
  });

  it("resolves the range (default 30 days) and passes the section on", async () => {
    await get("?section=sources");
    const [section, range] = lib.getAnalytics.mock.calls[0];
    expect(section).toBe("sources");
    expect(range).toMatchObject({ preset: "30d", days: 30 });

    await get("?section=ai&range=custom&from=2026-10-01&to=2026-10-05");
    expect(lib.getAnalytics.mock.calls[1][1]).toMatchObject({
      preset: "custom",
      from: "2026-10-01",
      to: "2026-10-05",
      prevFrom: "2026-09-26",
      prevTo: "2026-09-30",
    });
  });

  it("live ignores the range, even a bad one", async () => {
    const res = await get("?section=live&range=nonsense");
    expect(res.status).toBe(200);
    expect(lib.getAnalytics).toHaveBeenCalledWith("live", null);
  });

  it("returns the result as is, 200 for data and for not-connected", async () => {
    const res = await get("?section=overview");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, connected: false, section: "overview", missing: ["GA4_PROPERTY_ID"] });
  });

  it("502 with the friendly error when Google fails", async () => {
    lib.getAnalytics.mockResolvedValue({ ok: false, error: "Google took too long to answer. Please try again in a moment." });
    const res = await get("?section=overview&range=7d");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "Google took too long to answer. Please try again in a moment." });
  });
});
