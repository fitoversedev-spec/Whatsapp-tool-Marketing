/**
 * Field masks fail at request time, not compile time, and they decide the
 * price. These tests pin the two rules that are easy to break silently:
 * `places.` prefixes on search but not on details, and the tier a mask bills
 * at matching the tier the taxonomy declared.
 *
 * They cannot prove the field *names* are right — only a live key can, which
 * is why V3 exists in docs/PHASE-1-UNVERIFIED.md.
 */
import { describe, expect, it } from "vitest";

import {
  detailsFieldMask,
  fieldsForTier,
  fieldSetKey,
  searchFieldMask,
  skuTierForFields,
  tierSatisfies,
} from "./fieldMasks";
import type { SkuTier } from "./taxonomy";

const ALL_TIERS: SkuTier[] = ["ESSENTIALS", "PRO", "ENTERPRISE", "ENTERPRISE_ATMOSPHERE"];

describe("searchFieldMask", () => {
  it("prefixes every path with places.", () => {
    for (const tier of ALL_TIERS) {
      for (const path of searchFieldMask(tier).split(",")) {
        expect(path.startsWith("places.")).toBe(true);
      }
    }
  });

  it("contains no whitespace — Google rejects a mask with spaces", () => {
    for (const tier of ALL_TIERS) {
      expect(searchFieldMask(tier, true)).not.toMatch(/\s/);
    }
  });

  it("adds nextPageToken only when pagination is wanted", () => {
    expect(searchFieldMask("PRO")).not.toContain("nextPageToken");
    expect(searchFieldMask("PRO", true)).toContain("nextPageToken");
    // The token is not a place field, so it carries no `places.` prefix.
    expect(searchFieldMask("PRO", true)).toContain(",nextPageToken");
  });

  it("always asks for id and location — without them a place cannot be deduped or placed", () => {
    for (const tier of ALL_TIERS) {
      expect(searchFieldMask(tier)).toContain("places.id");
      expect(searchFieldMask(tier)).toContain("places.location");
    }
  });

  it("asks for reviews only at the Atmosphere tier", () => {
    expect(searchFieldMask("ENTERPRISE")).not.toContain("places.reviews");
    expect(searchFieldMask("ENTERPRISE_ATMOSPHERE")).toContain("places.reviews");
  });

  it("asks for rating and hours from Enterprise upward", () => {
    expect(searchFieldMask("PRO")).not.toContain("places.rating");
    expect(searchFieldMask("ENTERPRISE")).toContain("places.rating");
    expect(searchFieldMask("ENTERPRISE")).toContain("places.regularOpeningHours");
    expect(searchFieldMask("ENTERPRISE_ATMOSPHERE")).toContain("places.rating");
  });
});

describe("detailsFieldMask", () => {
  it("uses bare field names — a places. prefix is rejected on Place Details", () => {
    for (const tier of ALL_TIERS) {
      expect(detailsFieldMask(tier)).not.toContain("places.");
    }
  });

  it("requests the same fields as the search mask at the same tier", () => {
    for (const tier of ALL_TIERS) {
      expect(detailsFieldMask(tier).split(",")).toEqual(
        searchFieldMask(tier)
          .split(",")
          .map((f) => f.replace("places.", "")),
      );
    }
  });
});

describe("skuTierForFields", () => {
  it("inverts fieldsForTier for every tier", () => {
    for (const tier of ALL_TIERS) {
      expect(skuTierForFields(fieldsForTier(tier))).toBe(tier);
    }
  });

  it("bills at the highest tier any single field belongs to", () => {
    // This is Google's rule, and it is what makes an accidental `reviews` in a
    // demand-side mask a 25 % price rise across the whole scan.
    expect(skuTierForFields(["id", "location", "reviews"])).toBe("ENTERPRISE_ATMOSPHERE");
    expect(skuTierForFields(["id", "rating"])).toBe("ENTERPRISE");
    expect(skuTierForFields(["id", "displayName"])).toBe("PRO");
    expect(skuTierForFields(["id", "location"])).toBe("ESSENTIALS");
  });

  it("accepts prefixed search-style paths as well as bare ones", () => {
    expect(skuTierForFields(["places.id", "places.reviews"])).toBe("ENTERPRISE_ATMOSPHERE");
  });

  it("treats an empty mask as the cheapest tier", () => {
    expect(skuTierForFields([])).toBe("ESSENTIALS");
  });
});

describe("tierSatisfies", () => {
  it("lets a richer cached tier satisfy a poorer request", () => {
    expect(tierSatisfies("ENTERPRISE_ATMOSPHERE", "PRO")).toBe(true);
    expect(tierSatisfies("ENTERPRISE", "PRO")).toBe(true);
    expect(tierSatisfies("PRO", "PRO")).toBe(true);
  });

  it("refuses a poorer cached tier for a richer request", () => {
    // The bug this prevents: a place cached from a Pro search has no reviews,
    // and serving it to an Atmosphere request reports zero reviews for a venue
    // that has three hundred.
    expect(tierSatisfies("PRO", "ENTERPRISE_ATMOSPHERE")).toBe(false);
    expect(tierSatisfies("ENTERPRISE", "ENTERPRISE_ATMOSPHERE")).toBe(false);
    expect(tierSatisfies("ESSENTIALS", "PRO")).toBe(false);
  });

  it("treats an unknown cached tier as a miss", () => {
    expect(tierSatisfies(null, "PRO")).toBe(false);
    expect(tierSatisfies(undefined, "ESSENTIALS")).toBe(false);
  });
});

describe("fieldSetKey", () => {
  it("distinguishes every tier, so the cache key includes the field set", () => {
    expect(new Set(ALL_TIERS.map(fieldSetKey)).size).toBe(ALL_TIERS.length);
  });
});
