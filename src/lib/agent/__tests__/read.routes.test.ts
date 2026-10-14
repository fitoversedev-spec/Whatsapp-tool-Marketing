import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, verifyCredential, writeAgentAudit } = vi.hoisted(() => ({
  db: { setting: { findUnique: vi.fn() }, deal: { findMany: vi.fn() } },
  verifyCredential: vi.fn(),
  writeAgentAudit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));
vi.mock("../keys", () => ({ verifyCredential: (...a: unknown[]) => verifyCredential(...a) }));
vi.mock("../audit", () => ({ writeAgentAudit: (...a: unknown[]) => writeAgentAudit(...a) }));
vi.mock("../ratelimit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("../permissions", async () => {
  const actual = await vi.importActual<typeof import("../permissions")>("../permissions");
  return { ...actual, getEffectiveVerdict: async () => "ALLOWED" };
});

import { ROUTES } from "../registry/read";

const ROOT = path.resolve(__dirname, "../../../..");
const routeFile = (apiPath: string) =>
  path.join(ROOT, "src/app/api/agent/v1", apiPath.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");

describe("every stage-1 route file", () => {
  for (const r of ROUTES) {
    it(`${r.method.toUpperCase()} ${r.path} runs through withAgent with the right tool and config`, () => {
      const text = readFileSync(routeFile(r.path), "utf8");
      expect(text).toMatch(new RegExp(`withAgent\\(\\s*"${r.tool}"`));
      expect(text).toMatch(new RegExp(`export const ${r.method.toUpperCase()} =`));
      expect(text).toMatch(/export const dynamic = "force-dynamic";/);
      expect(text).toMatch(/export const runtime = "nodejs";/);
      expect(text).toMatch(/export const maxDuration = 30;/);
      // Reads are never mutating, so they need no Idempotency-Key and never queue approvals.
      expect(text).toMatch(new RegExp(`withAgent\\(\\s*"${r.tool}"[\\s\\S]*?mutating: false`));
      expect(text).not.toMatch(/verifyCredential|agent\/keys|getCurrentUser|requireUser/);
    });
  }
});

describe("through withAgent", () => {
  const AUTH = {
    ok: true,
    context: { identityId: "idn-1", userId: "usr-1", credentialId: "cred-1", environment: "staging", ip: "203.0.113.9" },
    meta: { identityName: "Agent", credentialLabel: "label", keyPrefix: "fvai_stg_abc", expiresAt: null },
  };
  const call = async (mod: string, init: { url: string; method?: string; body?: unknown }, params?: Record<string, string>) => {
    const { GET, POST } = (await import(/* @vite-ignore */ `@/app/api/agent/v1/${mod}/route`)) as Record<string, any>;
    const handler = init.method === "POST" ? POST : GET;
    const req = new Request(`https://app.test/api/agent/v1/${init.url}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const res: Response = await handler(req, { params });
    return { status: res.status, body: await res.json() };
  };

  beforeEach(() => {
    verifyCredential.mockReset().mockResolvedValue(AUTH);
    writeAgentAudit.mockReset().mockResolvedValue(undefined);
    db.setting.findUnique.mockReset().mockResolvedValue(null);
    db.deal.findMany.mockReset().mockResolvedValue([]);
  });

  it("rejects a limit above 100 on a list, before any query", async () => {
    const r = await call("deals", { url: "deals?limit=101" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_input");
    expect(r.body.error.message).toMatch(/limit/);
    expect(db.deal.findMany).not.toHaveBeenCalled();
  });

  it("requires a supported sport", async () => {
    const r = await call("pricing/rate-sheet", { url: "pricing/rate-sheet?sport=golf" });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/sport/);
    expect(db.setting.findUnique).not.toHaveBeenCalled();
  });

  it("serves the rate sheet with its source", async () => {
    const r = await call("pricing/rate-sheet", { url: "pricing/rate-sheet?sport=football" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sport: "football", source: "built_in_defaults", currency: "INR" });
    expect(r.body.items.map((i: { id: string }) => i.id)).toContain("turf");
  });

  it("estimates a price and saves nothing (no Idempotency-Key needed)", async () => {
    const r = await call("pricing/estimate", {
      url: "pricing/estimate",
      method: "POST",
      body: { sport: "football", lengthFt: 100, widthFt: 60 },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "estimate", subtotal: 1_946_400, gst: 177_660, total: 2_124_060, priceSource: "built_in_defaults" });
    // Audited as a read.
    expect(writeAgentAudit).toHaveBeenCalledTimes(1);
    expect(writeAgentAudit.mock.calls[0][0]).toMatchObject({ toolName: "estimate_price", action: "read", result: "success" });
    expect(writeAgentAudit.mock.calls[0][1]).toEqual({ mutating: false });
  });

  it("explains an invalid estimate", async () => {
    const bad = await call("pricing/estimate", { url: "pricing/estimate", method: "POST", body: { sport: "football", lengthFt: -5, widthFt: 60 } });
    expect(bad.status).toBe(400);
    const unknown = await call("pricing/estimate", {
      url: "pricing/estimate",
      method: "POST",
      body: { sport: "football", lengthFt: 10, widthFt: 10, items: [{ rateItemId: "gold_plating" }] },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toMatch(/Unknown rate item/);
  });

  it("will not accept a rate from the caller", async () => {
    const r = await call("pricing/estimate", {
      url: "pricing/estimate",
      method: "POST",
      body: { sport: "football", lengthFt: 100, widthFt: 60, items: [{ rateItemId: "turf", ratePerSqFt: 1, defaultRate: 1 }] },
    });
    // The extra keys are stripped, and the sheet's own rate (112) is the one used.
    expect(r.status).toBe(200);
    expect(r.body.lines.find((l: { rateItemId: string }) => l.rateItemId === "turf").ratePerUnit).toBe(112);
  });

  it("404s a malformed path id and an unknown report without touching the database", async () => {
    expect((await call("catalogue/products/[id]", { url: "catalogue/products/xyz" }, { id: "xyz" })).status).toBe(404);
    expect((await call("deals/[id]", { url: "deals/xyz" }, { id: "xyz" })).status).toBe(404);
    expect((await call("leads/[id]/timeline", { url: "leads/xyz/timeline" }, { id: "xyz" })).status).toBe(404);
    const rep = await call("analytics/[report]", { url: "analytics/rep_leaderboard" }, { report: "rep_leaderboard" });
    expect(rep.status).toBe(404);
    expect(rep.body.error.message).toMatch(/kpi_board/);
    expect(db.deal.findMany).not.toHaveBeenCalled();
  });

  it("refuses a bad analytics window", async () => {
    const r = await call("analytics/[report]", { url: "analytics/kpi_board?from=2026-01-01" }, { report: "kpi_board" });
    expect(r.status).toBe(400);
  });

  it("refuses a request with no credentials", async () => {
    verifyCredential.mockResolvedValue({ ok: false, reason: "missing", ip: null });
    const r = await call("pricing/rate-sheet", { url: "pricing/rate-sheet?sport=football" });
    expect(r.status).toBe(401);
  });
});
