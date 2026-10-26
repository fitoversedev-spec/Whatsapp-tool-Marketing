import { describe, expect, it } from "vitest";
import { finalTemperature, scoreChat, type ChatSignals } from "../scoring";

const now = new Date("2026-10-20T12:00:00Z");
const base: ChatSignals = {
  customerTexts: [],
  customerMessageCount: 1,
  lastCustomerMessageAt: new Date("2026-10-20T11:00:00Z"),
  askedForHuman: false,
  requirementKeys: [],
  inCrm: false,
  optedOut: false,
};

describe("scoreChat", () => {
  it("is HOT for a customer with budget, buying words and a human request", () => {
    const r = scoreChat(
      {
        ...base,
        customerTexts: ["We need 2 courts, what is the price? Can you do a site visit?"],
        customerMessageCount: 4,
        askedForHuman: true,
        requirementKeys: ["budgetInr", "city", "sport"],
        inCrm: true,
      },
      now,
    );
    expect(r.temperature).toBe("HOT");
    expect(r.signals).toContain("Asked to talk to a person");
  });

  it("is WARM for an engaged customer without strong intent", () => {
    const r = scoreChat({ ...base, customerTexts: ["Tell me about the price"], customerMessageCount: 3 }, now);
    expect(r.temperature).toBe("WARM");
  });

  it("is COLD for a quiet or uninterested customer", () => {
    expect(scoreChat({ ...base, customerMessageCount: 0, lastCustomerMessageAt: null }, now).temperature).toBe("COLD");
    expect(
      scoreChat({ ...base, customerTexts: ["Not interested, thanks"], lastCustomerMessageAt: new Date("2026-10-01T00:00:00Z") }, now)
        .temperature,
    ).toBe("COLD");
  });

  it("always treats an opted-out contact as COLD", () => {
    expect(scoreChat({ ...base, askedForHuman: true, requirementKeys: ["budgetInr", "timeline"], optedOut: true }, now)).toEqual({
      temperature: "COLD",
      score: 0,
      signals: ["Opted out"],
    });
  });

  it("matches whole words only", () => {
    const r = scoreChat({ ...base, customerTexts: ["we will separate the area by border"] }, now);
    expect(r.signals.some((s) => s.startsWith("Buying words"))).toBe(false);
  });
});

describe("finalTemperature", () => {
  const auto = scoreChat(base, now);
  it("prefers a saved label", () => {
    expect(finalTemperature(auto, { temperature: "HOT", source: "agent", reason: "budget confirmed" })).toEqual({
      temperature: "HOT",
      source: "agent",
      reason: "budget confirmed",
    });
  });
  it("falls back to the automatic score", () => {
    expect(finalTemperature(auto, null).source).toBe("auto");
  });
});
