import { describe, expect, it } from "vitest";
import { decideEligibility, isWindowOpen, WINDOW_MS } from "../messaging/eligibility";
import { DEDUPE_WINDOW_MS, findDuplicate, normaliseText } from "../messaging/dedupe";

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms);
const H = 3_600_000;

describe("24 hour window", () => {
  it("is open for an inbound message under 24 h old and closed at exactly 24 h", () => {
    expect(isWindowOpen(ago(1000), NOW)).toBe(true);
    expect(isWindowOpen(ago(WINDOW_MS - 1), NOW)).toBe(true);
    expect(isWindowOpen(ago(WINDOW_MS), NOW)).toBe(false);
    expect(isWindowOpen(ago(WINDOW_MS + 1), NOW)).toBe(false);
  });
  it("is closed when the contact never messaged", () => {
    expect(isWindowOpen(null, NOW)).toBe(false);
    expect(isWindowOpen(undefined, NOW)).toBe(false);
  });
});

describe("decideEligibility", () => {
  it("open window, not opted out: may reply", () => {
    const e = decideEligibility({ lastInboundAt: ago(2 * H), now: NOW, optedOut: false, allowCampaign: true });
    expect(e).toMatchObject({
      canReplyFreeText: true,
      windowOpen: true,
      optedOut: false,
      allowCampaign: true,
      canSendUtilityTemplate: true,
      canSendMarketingTemplate: true,
      reasonIfNot: null,
    });
    expect(e.windowEndsAt).toBe(new Date(NOW - 2 * H + WINDOW_MS).toISOString());
  });
  it("closed window: no free text, templates still possible", () => {
    const e = decideEligibility({ lastInboundAt: ago(30 * H), now: NOW, optedOut: false, allowCampaign: true });
    expect(e.canReplyFreeText).toBe(false);
    expect(e.reasonIfNot).toBe("window_closed");
    expect(e.canSendUtilityTemplate).toBe(true);
  });
  it("never messaged: window_closed and no windowEndsAt", () => {
    const e = decideEligibility({ lastInboundAt: null, now: NOW, optedOut: false, allowCampaign: null });
    expect(e).toMatchObject({ canReplyFreeText: false, windowEndsAt: null, reasonIfNot: "window_closed" });
  });
  it("opted out blocks everything and outranks the window reason", () => {
    const open = decideEligibility({ lastInboundAt: ago(H), now: NOW, optedOut: true, allowCampaign: true });
    expect(open).toMatchObject({
      canReplyFreeText: false,
      canSendUtilityTemplate: false,
      canSendMarketingTemplate: false,
      reasonIfNot: "opted_out",
    });
    const closed = decideEligibility({ lastInboundAt: ago(40 * H), now: NOW, optedOut: true, allowCampaign: true });
    expect(closed.reasonIfNot).toBe("opted_out");
  });
  it("allowCampaign only gates marketing, never a reply inside the window", () => {
    const off = decideEligibility({ lastInboundAt: ago(H), now: NOW, optedOut: false, allowCampaign: false });
    expect(off.canReplyFreeText).toBe(true);
    expect(off.canSendUtilityTemplate).toBe(true);
    expect(off.canSendMarketingTemplate).toBe(false);
  });
  it("no marketing contact record (null) is not campaign consent", () => {
    const e = decideEligibility({ lastInboundAt: ago(H), now: NOW, optedOut: false, allowCampaign: null });
    expect(e.canSendMarketingTemplate).toBe(false);
    expect(e.canReplyFreeText).toBe(true);
  });
});

describe("duplicate window", () => {
  const msg = (id: string, body: string | null, ageMs: number) => ({ id, body, createdAt: ago(ageMs) });

  it("is 10 minutes", () => expect(DEDUPE_WINDOW_MS).toBe(600_000));

  it("finds the same text inside the window", () => {
    const hit = findDuplicate([msg("a", "Hello there", 60_000)], "Hello there", NOW);
    expect(hit?.id).toBe("a");
  });
  it("matches ignoring case, edge space and repeated whitespace", () => {
    expect(findDuplicate([msg("a", "Hello   there \n", 1000)], "  hello there", NOW)?.id).toBe("a");
    expect(normaliseText("  A\tB  ")).toBe("a b");
  });
  it("ignores messages older than 10 minutes (boundary included)", () => {
    expect(findDuplicate([msg("a", "Hi", DEDUPE_WINDOW_MS)], "Hi", NOW)?.id).toBe("a");
    expect(findDuplicate([msg("a", "Hi", DEDUPE_WINDOW_MS + 1)], "Hi", NOW)).toBeNull();
  });
  it("ignores different text and null bodies", () => {
    expect(findDuplicate([msg("a", "Hi there", 1000)], "Hi", NOW)).toBeNull();
    expect(findDuplicate([msg("a", null, 1000)], "Hi", NOW)).toBeNull();
  });
  it("returns the most recent of several matches", () => {
    const hit = findDuplicate([msg("old", "Hi", 5 * 60_000), msg("new", "Hi", 1000), msg("mid", "Hi", 60_000)], "Hi", NOW);
    expect(hit?.id).toBe("new");
  });
  it("never treats empty text as a duplicate", () => {
    expect(findDuplicate([msg("a", "", 1000)], "   ", NOW)).toBeNull();
  });
});
