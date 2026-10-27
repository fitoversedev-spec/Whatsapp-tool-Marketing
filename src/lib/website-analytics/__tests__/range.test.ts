import { describe, expect, it } from "vitest";
import { addDays, dayCount, eachDay, isYmd, istDateOf, istDayEnd, istDayStart, resolveRange, todayIST } from "../range";

// 2026-10-27 10:00 IST
const now = new Date("2026-10-27T04:30:00Z");

const ok = (input: Parameters<typeof resolveRange>[0], at = now) => {
  const r = resolveRange(input, at);
  if (!r.ok) throw new Error(r.error);
  return r.range;
};
const err = (input: Parameters<typeof resolveRange>[0], at = now) => {
  const r = resolveRange(input, at);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("IST dates", () => {
  it("today is the IST calendar day, not the UTC one", () => {
    expect(todayIST(new Date("2026-10-26T20:00:00Z"))).toBe("2026-10-27"); // 01:30 IST next day
    expect(todayIST(new Date("2026-10-26T18:29:59Z"))).toBe("2026-10-26");
    expect(todayIST(new Date("2026-10-26T18:30:00Z"))).toBe("2026-10-27");
  });

  it("day arithmetic crosses month and year ends", () => {
    expect(addDays("2026-10-27", 5)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(dayCount("2026-10-01", "2026-10-31")).toBe(31);
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("an IST day is 18:30 UTC to 18:29:59.999 UTC", () => {
    expect(istDayStart("2026-10-27").toISOString()).toBe("2026-10-26T18:30:00.000Z");
    expect(istDayEnd("2026-10-27").toISOString()).toBe("2026-10-27T18:29:59.999Z");
    expect(istDateOf(new Date("2026-10-26T18:30:00Z"))).toBe("2026-10-27");
    expect(istDateOf(new Date("2026-10-27T18:29:59Z"))).toBe("2026-10-27");
  });

  it("isYmd only accepts real dates", () => {
    expect(isYmd("2026-10-27")).toBe(true);
    for (const v of ["2026-02-30", "2026-13-01", "2026-1-1", "27-10-2026", "", null, undefined, "2026-10-27T00:00"]) {
      expect(isYmd(v as string)).toBe(false);
    }
  });
});

describe("resolveRange presets", () => {
  it("defaults to the last 30 days, today included", () => {
    expect(ok({})).toEqual({
      preset: "30d",
      from: "2026-09-28",
      to: "2026-10-27",
      prevFrom: "2026-08-29",
      prevTo: "2026-09-27",
      days: 30,
    });
    expect(ok({ range: "" }).preset).toBe("30d");
  });

  it("7d", () => {
    expect(ok({ range: "7d" })).toEqual({
      preset: "7d",
      from: "2026-10-21",
      to: "2026-10-27",
      prevFrom: "2026-10-14",
      prevTo: "2026-10-20",
      days: 7,
    });
  });

  it("this month runs from the 1st to today, compared with the same number of days before", () => {
    expect(ok({ range: "this_month" })).toEqual({
      preset: "this_month",
      from: "2026-10-01",
      to: "2026-10-27",
      prevFrom: "2026-09-04",
      prevTo: "2026-09-30",
      days: 27,
    });
  });

  it("this month on the 1st is a single day", () => {
    const r = ok({ range: "this_month" }, new Date("2026-11-01T05:00:00Z"));
    expect([r.from, r.to, r.days, r.prevFrom, r.prevTo]).toEqual(["2026-11-01", "2026-11-01", 1, "2026-10-31", "2026-10-31"]);
  });

  it("last month is the whole previous month", () => {
    expect(ok({ range: "last_month" })).toEqual({
      preset: "last_month",
      from: "2026-09-01",
      to: "2026-09-30",
      prevFrom: "2026-08-02",
      prevTo: "2026-08-31",
      days: 30,
    });
  });

  it("last month across a year end and in February", () => {
    const jan = ok({ range: "last_month" }, new Date("2027-01-10T05:00:00Z"));
    expect([jan.from, jan.to, jan.days]).toEqual(["2026-12-01", "2026-12-31", 31]);
    const mar = ok({ range: "last_month" }, new Date("2026-03-10T05:00:00Z"));
    expect([mar.from, mar.to, mar.days]).toEqual(["2026-02-01", "2026-02-28", 28]);
  });

  it("uses the IST date near midnight", () => {
    // 23:30 UTC on the 26th is 05:00 IST on the 27th.
    expect(ok({ range: "7d" }, new Date("2026-10-26T23:30:00Z")).to).toBe("2026-10-27");
  });

  it("rejects an unknown preset", () => {
    expect(err({ range: "90d" })).toMatch(/unknown/i);
    expect(err({ range: "yesterday" })).toMatch(/unknown/i);
  });
});

describe("resolveRange custom", () => {
  it("takes from and to, with the previous period of the same length before", () => {
    expect(ok({ range: "custom", from: "2026-10-10", to: "2026-10-16" })).toEqual({
      preset: "custom",
      from: "2026-10-10",
      to: "2026-10-16",
      prevFrom: "2026-10-03",
      prevTo: "2026-10-09",
      days: 7,
    });
  });

  it("from and to alone mean custom", () => {
    expect(ok({ from: "2026-10-10", to: "2026-10-10" }).preset).toBe("custom");
  });

  it("allows today as the end and a single day", () => {
    expect(ok({ range: "custom", from: "2026-10-27", to: "2026-10-27" }).days).toBe(1);
  });

  it("needs both dates, real ones", () => {
    expect(err({ range: "custom" })).toMatch(/start and an end/i);
    expect(err({ range: "custom", from: "2026-10-01" })).toMatch(/start and an end/i);
    expect(err({ range: "custom", from: "2026-10-01", to: "2026-02-30" })).toMatch(/start and an end/i);
    expect(err({ range: "custom", from: "01/10/2026", to: "2026-10-05" })).toMatch(/start and an end/i);
  });

  it("from must not be after to", () => {
    expect(err({ range: "custom", from: "2026-10-12", to: "2026-10-11" })).toMatch(/after/i);
  });

  it("to can't be in the future (IST)", () => {
    expect(err({ range: "custom", from: "2026-10-20", to: "2026-10-28" })).toMatch(/future/i);
    // 22:00 UTC on the 27th is already the 28th in IST.
    const late = new Date("2026-10-27T22:00:00Z");
    expect(ok({ range: "custom", from: "2026-10-20", to: "2026-10-28" }, late).to).toBe("2026-10-28");
  });

  it("from can be at most 18 months back", () => {
    expect(ok({ range: "custom", from: "2025-04-27", to: "2026-10-27" }).from).toBe("2025-04-27");
    expect(err({ range: "custom", from: "2025-04-26", to: "2026-10-27" })).toMatch(/18 months/);
  });

  it("18 months back clamps to the end of a short month", () => {
    // 2026-10-31 minus 18 months is 2025-04-30 (April has 30 days).
    const at = new Date("2026-10-31T05:00:00Z");
    expect(ok({ range: "custom", from: "2025-04-30", to: "2026-10-31" }, at).days).toBeGreaterThan(500);
    expect(err({ range: "custom", from: "2025-04-29", to: "2026-10-31" }, at)).toMatch(/18 months/);
  });

  it("ignores from / to for a preset", () => {
    expect(ok({ range: "7d", from: "2020-01-01", to: "2020-01-02" }).days).toBe(7);
  });
});
