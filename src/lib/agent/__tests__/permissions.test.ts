import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { setting: { findUnique: (...a: unknown[]) => settingFindUnique(...a) } },
}));

import {
  effectiveTable,
  effectiveVerdict,
  getEffectiveVerdict,
  parseOverrides,
  resetOverridesCache,
  TOOL_REGISTRY,
  toolGroup,
} from "../permissions";

beforeEach(() => {
  TOOL_REGISTRY.t_allowed = { default: "ALLOWED", action: "read" };
  TOOL_REGISTRY.t_approval = { default: "APPROVAL", action: "send" };
  TOOL_REGISTRY.t_never = { default: "NEVER", action: "delete", neverLoosen: true };
  TOOL_REGISTRY.t_pinned = { default: "APPROVAL", action: "update", neverLoosen: true };
  resetOverridesCache();
  settingFindUnique.mockReset();
});
afterEach(() => {
  for (const t of ["t_allowed", "t_approval", "t_never", "t_pinned"]) delete TOOL_REGISTRY[t];
});

describe("effectiveVerdict", () => {
  it("registers whoami as ALLOWED", () => {
    expect(effectiveVerdict("whoami")).toBe("ALLOWED");
    expect(TOOL_REGISTRY.whoami.action).toBe("read");
  });

  it("treats an unknown tool as NEVER, even if an override says otherwise", () => {
    expect(effectiveVerdict("nope")).toBe("NEVER");
    expect(effectiveVerdict("nope", { nope: "ALLOWED" })).toBe("NEVER");
    expect(effectiveVerdict("")).toBe("NEVER");
  });

  it("is not fooled by prototype keys", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(effectiveVerdict(name)).toBe("NEVER");
    }
  });

  it("overrides can only make a tool stricter", () => {
    expect(effectiveVerdict("t_allowed", { t_allowed: "APPROVAL" })).toBe("APPROVAL");
    expect(effectiveVerdict("t_allowed", { t_allowed: "NEVER" })).toBe("NEVER");
    expect(effectiveVerdict("t_approval", { t_approval: "NEVER" })).toBe("NEVER");
    // loosening is ignored
    expect(effectiveVerdict("t_approval", { t_approval: "ALLOWED" })).toBe("APPROVAL");
    expect(effectiveVerdict("t_never", { t_never: "ALLOWED" })).toBe("NEVER");
    expect(effectiveVerdict("t_never", { t_never: "APPROVAL" })).toBe("NEVER");
  });

  it("neverLoosen tools stay put when overridden toward ALLOWED, but can still tighten", () => {
    expect(effectiveVerdict("t_pinned", { t_pinned: "ALLOWED" })).toBe("APPROVAL");
    expect(effectiveVerdict("t_pinned", { t_pinned: "NEVER" })).toBe("NEVER");
  });

  it("ignores malformed overrides", () => {
    for (const bad of [
      null,
      undefined,
      "NEVER",
      42,
      [],
      ["NEVER"],
      { t_allowed: "never" },
      { t_allowed: 3 },
      { t_allowed: null },
    ]) {
      expect(effectiveVerdict("t_allowed", bad)).toBe("ALLOWED");
    }
  });

  it("effectiveTable lists every registered tool", () => {
    const table = effectiveTable({ t_allowed: "NEVER" });
    expect(table.whoami).toBe("ALLOWED");
    expect(table.t_allowed).toBe("NEVER");
    expect(Object.keys(table).sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
  });

  it("groups default to the action", () => {
    expect(toolGroup("whoami")).toBe("read");
    expect(toolGroup("t_approval")).toBe("send");
    expect(toolGroup("nope")).toBe("unknown");
  });
});

describe("overrides from the Setting table", () => {
  it("parseOverrides tolerates garbage", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("not json")).toEqual({});
    expect(parseOverrides('{"a":"NEVER"}')).toEqual({ a: "NEVER" });
  });

  it("getEffectiveVerdict reads agent_permission_overrides and caches briefly", async () => {
    settingFindUnique.mockResolvedValue({ value: JSON.stringify({ t_allowed: "NEVER", t_approval: "ALLOWED" }) });
    expect(await getEffectiveVerdict("t_allowed")).toBe("NEVER");
    expect(await getEffectiveVerdict("t_approval")).toBe("APPROVAL");
    expect(settingFindUnique).toHaveBeenCalledTimes(1);
    expect(settingFindUnique).toHaveBeenCalledWith({ where: { key: "agent_permission_overrides" } });
  });

  it("falls back to code defaults when the setting is missing or broken", async () => {
    settingFindUnique.mockResolvedValue(null);
    expect(await getEffectiveVerdict("t_approval")).toBe("APPROVAL");
    resetOverridesCache();
    settingFindUnique.mockResolvedValue({ value: "{{{" });
    expect(await getEffectiveVerdict("t_allowed")).toBe("ALLOWED");
  });
});
