import { describe, expect, it } from "vitest";

import {
  assistAriaLabel,
  assistBadgeCount,
  assistClick,
  assistTargets,
  nextMenuIndex,
  unreadAnnouncement,
  unreadLabel,
} from "./assist";

describe("assistTargets", () => {
  it("lists Ask AI before Team chat", () => {
    expect(assistTargets({ ai: true, chat: true })).toEqual(["ai", "chat"]);
  });
  it("drops whichever the user may not use", () => {
    expect(assistTargets({ ai: false, chat: true })).toEqual(["chat"]);
    expect(assistTargets({ ai: true, chat: false })).toEqual(["ai"]);
    expect(assistTargets({ ai: false, chat: false })).toEqual([]);
  });
});

describe("assistClick", () => {
  it("opens a menu when both panels are available and none is open", () => {
    expect(assistClick(["ai", "chat"], [])).toEqual({ kind: "menu" });
  });
  it("opens the only available panel directly, without a menu", () => {
    expect(assistClick(["chat"], [])).toEqual({ kind: "open", target: "chat" });
    expect(assistClick(["ai"], [])).toEqual({ kind: "open", target: "ai" });
  });
  it("opens the other panel when one is already open (side by side)", () => {
    expect(assistClick(["ai", "chat"], ["ai"])).toEqual({ kind: "open", target: "chat" });
    expect(assistClick(["ai", "chat"], ["chat"])).toEqual({ kind: "open", target: "ai" });
  });
  it("closes once every panel the user may open is open", () => {
    expect(assistClick(["ai", "chat"], ["ai", "chat"])).toEqual({ kind: "close" });
    expect(assistClick(["ai"], ["ai"])).toEqual({ kind: "close" });
  });
  it("does nothing when the user has neither", () => {
    expect(assistClick([], [])).toEqual({ kind: "none" });
  });
});

describe("unreadLabel", () => {
  it("is empty for zero, negative and NaN", () => {
    expect(unreadLabel(0)).toBe("");
    expect(unreadLabel(-3)).toBe("");
    expect(unreadLabel(NaN)).toBe("");
  });
  it("shows the number up to 99 and caps above", () => {
    expect(unreadLabel(1)).toBe("1");
    expect(unreadLabel(99)).toBe("99");
    expect(unreadLabel(100)).toBe("99+");
    expect(unreadLabel(1234)).toBe("99+");
  });
});

describe("assistBadgeCount", () => {
  it("adds unread messages and pending handoff asks", () => {
    expect(assistBadgeCount(3, 2)).toBe(5);
  });
  it("never goes negative", () => {
    expect(assistBadgeCount(-1, 2)).toBe(2);
    expect(assistBadgeCount(0, 0)).toBe(0);
  });
});

describe("assistAriaLabel", () => {
  it("names both and appends the unread count", () => {
    expect(assistAriaLabel({ targets: ["ai", "chat"], openTargets: [], unread: 3 })).toBe(
      "AI assistant and team chat (3 unread)"
    );
  });
  it("omits the count when there is nothing unread", () => {
    expect(assistAriaLabel({ targets: ["ai", "chat"], openTargets: [], unread: 0 })).toBe(
      "AI assistant and team chat"
    );
  });
  it("caps a large count", () => {
    expect(assistAriaLabel({ targets: ["chat"], openTargets: [], unread: 250 })).toBe("Team chat (99+ unread)");
  });
  it("does not mention unread for an AI-only user", () => {
    expect(assistAriaLabel({ targets: ["ai"], openTargets: [], unread: 4 })).toBe("Ask AI");
  });
  it("says what the × will close once every panel is open", () => {
    expect(assistAriaLabel({ targets: ["ai", "chat"], openTargets: ["ai", "chat"], unread: 0 })).toBe(
      "Close Ask AI and team chat"
    );
    expect(assistAriaLabel({ targets: ["chat"], openTargets: ["chat"], unread: 4 })).toBe("Close team chat");
  });
  it("offers the other panel while one is open", () => {
    expect(assistAriaLabel({ targets: ["ai", "chat"], openTargets: ["chat"], unread: 4 })).toBe("Open Ask AI");
    expect(assistAriaLabel({ targets: ["ai", "chat"], openTargets: ["ai"], unread: 4 })).toBe(
      "Open team chat (4 unread)"
    );
    expect(assistAriaLabel({ targets: ["ai", "chat"], openTargets: ["ai"], unread: 0 })).toBe("Open team chat");
  });
});

describe("unreadAnnouncement", () => {
  it("announces only increases", () => {
    expect(unreadAnnouncement(2, 5)).toBe("5 unread in team chat");
    expect(unreadAnnouncement(5, 5)).toBe("");
    expect(unreadAnnouncement(5, 2)).toBe("");
    expect(unreadAnnouncement(0, 0)).toBe("");
  });
  it("uses the capped label", () => {
    expect(unreadAnnouncement(98, 120)).toBe("99+ unread in team chat");
  });
});

describe("nextMenuIndex", () => {
  it("moves down and up, wrapping at both ends", () => {
    expect(nextMenuIndex(0, "ArrowDown", 2)).toBe(1);
    expect(nextMenuIndex(1, "ArrowDown", 2)).toBe(0);
    expect(nextMenuIndex(1, "ArrowUp", 2)).toBe(0);
    expect(nextMenuIndex(0, "ArrowUp", 2)).toBe(1);
  });
  it("jumps with Home/End", () => {
    expect(nextMenuIndex(1, "Home", 3)).toBe(0);
    expect(nextMenuIndex(0, "End", 3)).toBe(2);
  });
  it("starts from the matching end when nothing is focused", () => {
    expect(nextMenuIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextMenuIndex(-1, "ArrowUp", 3)).toBe(2);
  });
  it("returns -1 for an empty menu", () => {
    expect(nextMenuIndex(0, "ArrowDown", 0)).toBe(-1);
  });
});
