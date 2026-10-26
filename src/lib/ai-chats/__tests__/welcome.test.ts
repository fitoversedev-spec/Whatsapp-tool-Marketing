import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/whatsapp", () => ({ sendTemplate: vi.fn(), isMetaConfigured: vi.fn(), describeMetaError: vi.fn() }));

import { defaultVariables, parseWelcomeSetting } from "../welcome";

describe("welcome templates", () => {
  it("reads the admin's list safely", () => {
    expect(parseWelcomeSetting('{"templateIds":["a","b"]}')).toEqual(["a", "b"]);
    expect(parseWelcomeSetting("not json")).toEqual([]);
    expect(parseWelcomeSetting(null)).toEqual([]);
  });

  it("fills {{1}} with the lead's first name", () => {
    expect(defaultVariables("Hi {{1}}, thanks for your enquiry!", "Sneha Kapoor")).toEqual(["Sneha"]);
    expect(defaultVariables("Hi {{1}}!", null)).toEqual(["there"]);
    expect(defaultVariables("Thanks for your enquiry!", "Sneha")).toEqual([]);
    expect(defaultVariables("Hi {{1}}, your {{2}}", "Sneha")).toBeNull();
  });
});
