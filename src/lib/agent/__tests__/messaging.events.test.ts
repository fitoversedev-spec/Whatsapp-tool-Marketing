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
  checkEventStart,
  decodeCursor,
  encodeCursor,
  MAX_EVENT_AGE_MS,
  mergeEvents,
  parseEventTypes,
} from "../messaging/events";
import {
  chargeConversationLimit,
  DEFAULT_PER_CONVERSATION_HOUR,
  resetConversationLimitCache,
  resolvePerConversationHour,
} from "../messaging/limits";

describe("cursors", () => {
  it("round-trips a time and an id", () => {
    const c = encodeCursor({ t: new Date("2026-10-13T10:00:00.000Z"), id: "abc-123" });
    expect(decodeCursor(c)).toEqual({ t: "2026-10-13T10:00:00.000Z", id: "abc-123" });
  });
  it("rejects anything we did not issue", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-base64-json!!")).toBeNull();
    expect(decodeCursor(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":"nope","id":"x"}').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`{"t":"2026-01-01T00:00:00Z","id":"${"x".repeat(65)}"}`).toString("base64url"))).toBeNull();
  });
});

describe("event types and the 7 day limit", () => {
  it("parses the types list", () => {
    expect(parseEventTypes(undefined)).toEqual(["message", "lead"]);
    expect(parseEventTypes("lead")).toEqual(["lead"]);
    expect(parseEventTypes(" Message , lead,message")).toEqual(["message", "lead"]);
    expect(parseEventTypes("message,spam")).toBeNull();
    expect(parseEventTypes(",")).toBeNull();
  });
  it("allows up to 7 days back and no further", () => {
    const now = Date.UTC(2026, 9, 13, 12);
    expect(checkEventStart(new Date(now - MAX_EVENT_AGE_MS), now)).toEqual({ ok: true });
    expect(checkEventStart(new Date(now), now)).toEqual({ ok: true });
    const old = checkEventStart(new Date(now - MAX_EVENT_AGE_MS - 1), now);
    expect(old.ok).toBe(false);
    expect(old.ok === false && old.earliest).toBe(new Date(now - MAX_EVENT_AGE_MS).toISOString());
  });
});

describe("mergeEvents", () => {
  const ev = (type: "message" | "lead", id: string, at: string) => ({ type, id, at });
  it("orders by time then id across sources and trims to the limit", () => {
    const m = mergeEvents(
      [
        [ev("message", "m1", "2026-10-13T10:00:02.000Z"), ev("message", "m2", "2026-10-13T10:00:05.000Z")],
        [ev("lead", "l1", "2026-10-13T10:00:01.000Z"), ev("lead", "a", "2026-10-13T10:00:02.000Z")],
      ],
      3,
    );
    expect(m.events.map((e) => e.id)).toEqual(["l1", "a", "m1"]);
    expect(m.hasMore).toBe(true);
    expect(decodeCursor(m.nextCursor)).toEqual({ t: "2026-10-13T10:00:02.000Z", id: "m1" });
  });
  it("reports no more and a null cursor when nothing came back", () => {
    expect(mergeEvents([[], []], 10)).toEqual({ events: [], hasMore: false, nextCursor: null });
  });
  it("is not truncated when exactly at the limit", () => {
    const m = mergeEvents([[ev("lead", "a", "2026-10-13T10:00:00.000Z")]], 1);
    expect(m.hasMore).toBe(false);
    expect(m.events).toHaveLength(1);
  });
});

describe("per-conversation hourly limit", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    settingFindUnique.mockReset();
    resetConversationLimitCache();
  });

  it("defaults to 10 and reads perConversationHour from the settings", () => {
    expect(DEFAULT_PER_CONVERSATION_HOUR).toBe(10);
    expect(resolvePerConversationHour(undefined)).toBe(10);
    expect(resolvePerConversationHour({ perConversationHour: 3 })).toBe(3);
    expect(resolvePerConversationHour({ perConversationHour: 0 })).toBe(10);
    expect(resolvePerConversationHour({ perConversationHour: 2.5 })).toBe(10);
    expect(resolvePerConversationHour({ perConversationHour: "5" })).toBe(10);
    expect(resolvePerConversationHour({ perConversationHour: 5000 })).toBe(10);
    expect(resolvePerConversationHour([5])).toBe(10);
  });

  it("allows up to the limit and blocks the next one, counting under conv:<id>", async () => {
    settingFindUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([{ count: 10 }]);
    expect(await chargeConversationLimit("idn", "conv-1")).toEqual({ allowed: true });
    // the scope is passed as a bound parameter of the tagged template
    expect(JSON.stringify(queryRaw.mock.calls[0])).toContain("conv:conv-1");
    queryRaw.mockResolvedValue([{ count: 11 }]);
    const blocked = await chargeConversationLimit("idn", "conv-1", Date.UTC(2026, 9, 13, 12, 59, 0));
    expect(blocked).toMatchObject({ allowed: false, limit: 10, retryAfterSec: 60 });
  });

  it("honours a configured limit", async () => {
    settingFindUnique.mockResolvedValue({ value: JSON.stringify({ perConversationHour: 2 }) });
    queryRaw.mockResolvedValue([{ count: 3 }]);
    expect(await chargeConversationLimit("idn", "c")).toMatchObject({ allowed: false, limit: 2 });
    queryRaw.mockResolvedValue([{ count: 2 }]);
    expect(await chargeConversationLimit("idn", "c")).toEqual({ allowed: true });
  });

  it("falls back to the default when the setting is unreadable", async () => {
    settingFindUnique.mockResolvedValue({ value: "{broken" });
    queryRaw.mockResolvedValue([{ count: 10 }]);
    expect(await chargeConversationLimit("idn", "c")).toEqual({ allowed: true });
  });
});
