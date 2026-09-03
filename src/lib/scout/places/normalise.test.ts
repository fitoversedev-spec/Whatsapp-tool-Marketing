import { describe, expect, it } from "vitest";

import type { GoogleOpeningHours, GooglePlace } from "./googleTypes";
import { deriveOperatingWindow, normalisePlace, UNKNOWN_OPERATING_WINDOW } from "./normalise";

function hours(periods: GoogleOpeningHours["periods"]): GoogleOpeningHours {
  return { periods };
}

/** Shorthand: one open period on `day`, from `oh:00` to `ch:00`. */
function period(day: number, oh: number, ch: number) {
  return { open: { day, hour: oh, minute: 0 }, close: { day, hour: ch, minute: 0 } };
}

describe("deriveOperatingWindow", () => {
  it("returns the unknown window when Google sent no hours", () => {
    expect(deriveOperatingWindow(undefined)).toEqual(UNKNOWN_OPERATING_WINDOW);
    expect(deriveOperatingWindow(hours([]))).toEqual(UNKNOWN_OPERATING_WINDOW);
  });

  it("flags a turf open till 11 pm as closing late", () => {
    // The distinction the client cares about: 7–11 pm is the highest-revenue
    // window, so a competitor holding it is a different competitor entirely.
    const window = deriveOperatingWindow(hours([period(1, 6, 23)]));
    expect(window.closesLate).toBe(true);
    expect(window.opensEarly).toBe(true);
    expect(window.latestCloseMinute).toBe(23 * 60);
    expect(window.earliestOpenMinute).toBe(6 * 60);
  });

  it("does not flag a place closing at 8 pm as closing late", () => {
    const window = deriveOperatingWindow(hours([period(1, 9, 20)]));
    expect(window.closesLate).toBe(false);
    expect(window.opensEarly).toBe(false);
  });

  it("treats exactly 10 pm as closing late and exactly 7 am as not opening early", () => {
    const window = deriveOperatingWindow(hours([period(1, 7, 22)]));
    expect(window.closesLate).toBe(true);
    expect(window.opensEarly).toBe(false);
  });

  it("rolls a past-midnight close forward instead of reading it as an early close", () => {
    // A turf open 06:00–01:00 reports close day+1 at 01:00. Naively that is
    // 60 minutes, which is "earlier than it opened" — and would flip
    // closesLate to false on the very venues that hold the evening peak.
    const window = deriveOperatingWindow(
      hours([{ open: { day: 5, hour: 6, minute: 0 }, close: { day: 6, hour: 1, minute: 0 } }]),
    );
    expect(window.latestCloseMinute).toBe(25 * 60);
    expect(window.closesLate).toBe(true);
    expect(window.longestSessionMinutes).toBe(19 * 60);
  });

  it("reports a 24-hour place as always open", () => {
    const window = deriveOperatingWindow(hours([{ open: { day: 0, hour: 0, minute: 0 } }]));
    expect(window.alwaysOpen).toBe(true);
    expect(window.closesLate).toBe(true);
    expect(window.longestSessionMinutes).toBe(24 * 60);
  });

  it("detects Sunday hours", () => {
    expect(deriveOperatingWindow(hours([period(1, 9, 18)])).openSunday).toBe(false);
    expect(deriveOperatingWindow(hours([period(0, 9, 18)])).openSunday).toBe(true);
  });

  it("lists open days in order across a full week", () => {
    const window = deriveOperatingWindow(
      hours([period(3, 9, 18), period(1, 6, 22), period(0, 8, 20)]),
    );
    expect(window.openDays).toEqual([0, 1, 3]);
    expect(window.earliestOpenMinute).toBe(6 * 60);
    expect(window.latestCloseMinute).toBe(22 * 60);
  });

  it("takes the longest session across the week, not the last one seen", () => {
    const window = deriveOperatingWindow(hours([period(1, 9, 11), period(2, 6, 22)]));
    expect(window.longestSessionMinutes).toBe(16 * 60);
  });

  it("ignores a period with no open time rather than crashing", () => {
    const window = deriveOperatingWindow(hours([{ close: { day: 1, hour: 18, minute: 0 } }]));
    expect(window).toEqual(UNKNOWN_OPERATING_WINDOW);
  });

  it("defaults a missing hour or minute to zero", () => {
    const window = deriveOperatingWindow(hours([{ open: { day: 2 }, close: { day: 2, hour: 18 } }]));
    expect(window.earliestOpenMinute).toBe(0);
    expect(window.latestCloseMinute).toBe(18 * 60);
  });
});

describe("normalisePlace", () => {
  const base: GooglePlace = {
    id: "ChIJtest",
    displayName: { text: "Turf Arena" },
    location: { latitude: 12.9784, longitude: 77.6408 },
  };

  it("keeps a missing rating as null rather than zero", () => {
    // Coercing absent to zero drags the catchment average down and corrupts
    // score component 3 — for every place a Pro-tier search returned.
    const place = normalisePlace(base)!;
    expect(place.rating).toBeNull();
    expect(place.reviewCount).toBeNull();
    expect(place.priceLevel).toBeNull();
  });

  it("maps the price level enum to the legacy 0–4 scale", () => {
    expect(normalisePlace({ ...base, priceLevel: "PRICE_LEVEL_FREE" })!.priceLevel).toBe(0);
    expect(normalisePlace({ ...base, priceLevel: "PRICE_LEVEL_MODERATE" })!.priceLevel).toBe(2);
    expect(normalisePlace({ ...base, priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE" })!.priceLevel).toBe(4);
    expect(normalisePlace({ ...base, priceLevel: "PRICE_LEVEL_UNSPECIFIED" })!.priceLevel).toBeNull();
  });

  it("rejects a place with no id — it could never be deduped", () => {
    expect(normalisePlace({ ...base, id: undefined, name: undefined })).toBeNull();
  });

  it("falls back to the resource name when only that is present", () => {
    const place = normalisePlace({ ...base, id: undefined, name: "places/ChIJfromName" })!;
    expect(place.placeId).toBe("ChIJfromName");
  });

  it("rejects a place with a missing or invalid coordinate", () => {
    expect(normalisePlace({ ...base, location: undefined })).toBeNull();
    expect(normalisePlace({ ...base, location: { latitude: 91, longitude: 0 } })).toBeNull();
    expect(
      normalisePlace({ ...base, location: { latitude: Number.NaN, longitude: 0 } }),
    ).toBeNull();
  });

  it("names an unnamed place rather than storing an empty string", () => {
    expect(normalisePlace({ ...base, displayName: undefined })!.name).toBe("(unnamed)");
    expect(normalisePlace({ ...base, displayName: { text: "   " } })!.name).toBe("(unnamed)");
  });

  it("prefers the national phone number and falls back to the international one", () => {
    expect(normalisePlace({ ...base, nationalPhoneNumber: "080 1234" })!.phone).toBe("080 1234");
    expect(normalisePlace({ ...base, internationalPhoneNumber: "+91 80 1234" })!.phone).toBe(
      "+91 80 1234",
    );
  });

  it("caps reviews at five, which is all Google returns", () => {
    const reviews = Array.from({ length: 9 }, (_, i) => ({
      name: `places/x/reviews/${i}`,
      rating: 4,
      text: { text: `review ${i}` },
    }));
    expect(normalisePlace({ ...base, reviews })!.reviews).toHaveLength(5);
  });

  it("prefers the reviewer's original text over Google's translation", () => {
    // Phase 3's theme extraction reads better on what the reviewer wrote than
    // on a machine translation of it.
    const place = normalisePlace({
      ...base,
      reviews: [
        {
          name: "places/x/reviews/1",
          text: { text: "Translated", languageCode: "en" },
          originalText: { text: "Original", languageCode: "kn" },
        },
      ],
    })!;
    expect(place.reviews[0]!.text).toBe("Original");
    expect(place.reviews[0]!.languageCode).toBe("kn");
  });

  it("parses a review publish time and tolerates a broken one", () => {
    const ok = normalisePlace({
      ...base,
      reviews: [{ name: "r1", publishTime: "2026-05-01T10:00:00Z" }],
    })!;
    expect(ok.reviews[0]!.publishedAt?.toISOString()).toBe("2026-05-01T10:00:00.000Z");

    const bad = normalisePlace({ ...base, reviews: [{ name: "r2", publishTime: "not a date" }] })!;
    expect(bad.reviews[0]!.publishedAt).toBeNull();
  });

  it("derives the operating window as part of normalisation", () => {
    const place = normalisePlace({ ...base, regularOpeningHours: hours([period(1, 6, 23)]) })!;
    expect(place.operatingWindow.closesLate).toBe(true);
    expect(place.hours).not.toBeNull();
  });

  it("carries through the fields Phase 3 and the report need", () => {
    const place = normalisePlace({
      ...base,
      formattedAddress: "100 Ft Rd, Indiranagar",
      types: ["gym", "point_of_interest"],
      primaryType: "gym",
      primaryTypeDisplayName: { text: "Gym" },
      googleMapsUri: "https://maps.google.com/?cid=1",
      businessStatus: "OPERATIONAL",
      websiteUri: "https://example.com",
      rating: 4.4,
      userRatingCount: 312,
    })!;

    expect(place).toMatchObject({
      address: "100 Ft Rd, Indiranagar",
      googleTypes: ["gym", "point_of_interest"],
      primaryType: "gym",
      primaryTypeDisplayName: "Gym",
      businessStatus: "OPERATIONAL",
      website: "https://example.com",
      rating: 4.4,
      reviewCount: 312,
    });
  });
});
