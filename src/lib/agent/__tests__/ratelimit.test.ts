import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const settingFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    $executeRaw: vi.fn(),
    setting: { findUnique: (...a: unknown[]) => settingFindUnique(...a) },
  },
}));
vi.mock("@/lib/scout/after", () => ({ after: () => undefined }));

import {
  checkRateLimit,
  DEFAULT_RATE_LIMITS,
  resetRateLimitCache,
  resolveLimits,
  secondsUntilNextWindow,
  windowStart,
} from "../ratelimit";

beforeEach(() => {
  queryRaw.mockReset();
  settingFindUnique.mockReset();
  settingFindUnique.mockResolvedValue(null);
  resetRateLimitCache();
});

describe("limits", () => {
  it("defaults to 60/min and 1000/hour", () => {
    expect(DEFAULT_RATE_LIMITS).toMatchObject({ perMinute: 60, perHour: 1000 });
    expect(resolveLimits(undefined)).toEqual({ perMinute: 60, perHour: 1000, groups: {} });
  });
  it("merges valid stored values and ignores invalid ones", () => {
    expect(resolveLimits({ perMinute: 5, perHour: "x" })).toEqual({ perMinute: 5, perHour: 1000, groups: {} });
    expect(resolveLimits({ perMinute: -1, perHour: 0 })).toEqual({ perMinute: 60, perHour: 1000, groups: {} });
    expect(resolveLimits({ perMinute: 1.5 })).toMatchObject({ perMinute: 60 });
    expect(resolveLimits([1, 2])).toMatchObject({ perMinute: 60 });
    expect(resolveLimits({ groups: { send: { perMinute: 3 }, "Bad Name": { perMinute: 1 }, junk: 5 } })).toEqual({
      perMinute: 60,
      perHour: 1000,
      groups: { send: { perMinute: 3, perHour: 1000 } },
    });
  });
  it("computes window starts and Retry-After", () => {
    const t = Date.UTC(2026, 9, 13, 12, 34, 56, 500);
    expect(windowStart(t, 60_000).toISOString()).toBe("2026-10-13T12:34:00.000Z");
    expect(windowStart(t, 3_600_000).toISOString()).toBe("2026-10-13T12:00:00.000Z");
    expect(secondsUntilNextWindow(t, 60_000)).toBe(4);
    expect(secondsUntilNextWindow(Date.UTC(2026, 9, 13, 12, 34, 0, 0), 60_000)).toBe(60);
  });
});

describe("checkRateLimit", () => {
  const now = Date.UTC(2026, 9, 13, 12, 34, 56, 0);

  it("allows a request under both limits and charges minute then hour with one statement each", async () => {
    queryRaw.mockResolvedValue([{ count: 1 }]);
    expect(await checkRateLimit("idn", "whoami", now)).toEqual({ allowed: true });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const [strings, ...values] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join("?");
    expect(sql).toContain("INSERT INTO agent_rate_buckets");
    expect(sql).toContain("ON CONFLICT (identity_id, scope, window_start)");
    expect(sql).toContain("DO UPDATE SET count = agent_rate_buckets.count + 1");
    expect(sql).toContain("RETURNING count");
    expect(values).toEqual(["idn", "m:all", "2026-10-13T12:34:00.000Z"]);
    expect(queryRaw.mock.calls[1].slice(1)).toEqual(["idn", "h:all", "2026-10-13T12:00:00.000Z"]);
  });

  it("denies over the per-minute limit with Retry-After and does not charge the hour", async () => {
    queryRaw.mockResolvedValue([{ count: 61 }]);
    const d = await checkRateLimit("idn", "whoami", now);
    expect(d).toEqual({ allowed: false, retryAfterSec: 4, scope: "m:all", limit: 60 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("allows exactly the limit and denies the next", async () => {
    queryRaw.mockResolvedValueOnce([{ count: 60 }]).mockResolvedValueOnce([{ count: 1 }]);
    expect((await checkRateLimit("idn", "whoami", now)).allowed).toBe(true);
    queryRaw.mockReset();
    queryRaw.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([{ count: 1001 }]);
    const d = await checkRateLimit("idn", "whoami", now);
    expect(d).toMatchObject({ allowed: false, scope: "h:all", limit: 1000 });
    if (!d.allowed) expect(d.retryAfterSec).toBe(Math.ceil((3_600_000 - (34 * 60 + 56) * 1000) / 1000));
  });

  it("applies a tool-group limit from the agent_rate_limits setting", async () => {
    settingFindUnique.mockResolvedValue({ value: JSON.stringify({ groups: { read: { perMinute: 2, perHour: 10 } } }) });
    queryRaw.mockImplementation(async (_s: unknown, _id: string, scope: string) => [{ count: scope === "m:grp:read" ? 3 : 1 }]);
    const d = await checkRateLimit("idn", "whoami", now);
    expect(d).toMatchObject({ allowed: false, scope: "m:grp:read", limit: 2 });
    expect(settingFindUnique).toHaveBeenCalledWith({ where: { key: "agent_rate_limits" } });
  });

  it("scopes are per identity (the identity id is the first bound value)", async () => {
    queryRaw.mockResolvedValue([{ count: 1 }]);
    await checkRateLimit("idn-A", "whoami", now);
    await checkRateLimit("idn-B", "whoami", now);
    const ids = queryRaw.mock.calls.map((c) => c[1]);
    expect(new Set(ids)).toEqual(new Set(["idn-A", "idn-B"]));
  });
});
