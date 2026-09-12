/**
 * The taxonomy is data, not code, so these tests guard the invariants a future
 * edit could break without any compiler noticing: a duplicated id that silently
 * merges two categories, a `nearby` term with no Google type, a preset naming a
 * category that was renamed.
 *
 * Ids are persisted in `scan_places.categories` and `scans.search_terms`, so a
 * rename is a data migration, not a refactor. That is what the "never rename"
 * test is for.
 */
import { describe, expect, it } from "vitest";

import {
  allSportFormats,
  categoriesForPreset,
  CATEGORIES,
  getCategory,
  getPreset,
  isSportMismatch,
  PRESETS,
  publicTaxonomy,
  resolveCategories,
  resolveTerms,
  shouldFilterCompetition,
  unknownCategoryIds,
} from "./taxonomy";

describe("taxonomy structure", () => {
  it("has the expected competition and demand categories", () => {
    expect(CATEGORIES.filter((c) => c.side === "competition")).toHaveLength(10);
    expect(CATEGORIES.filter((c) => c.side === "demand")).toHaveLength(6);
  });

  it("covers all sport formats", () => {
    expect(allSportFormats().sort()).toEqual(
      [
        "badminton",
        "basketball",
        "box-cricket",
        "cricket-nets",
        "football-turf-5s",
        "football-turf-7s",
        "pickleball",
        "running-track",
        "squash",
        "table-tennis",
        "tennis",
        "volleyball",
      ].sort(),
    );
  });

  it("has unique category ids", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has globally unique term ids — they are the dedupe key in matched_terms", () => {
    const ids = CATEGORIES.flatMap((c) => c.terms.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every category at least one term", () => {
    for (const category of CATEGORIES) {
      expect(category.terms.length).toBeGreaterThan(0);
    }
  });

  it("gives every nearby term at least one Google place type and no text queries", () => {
    for (const category of CATEGORIES) {
      for (const term of category.terms) {
        if (term.mode !== "nearby") continue;
        expect(term.googleTypes?.length ?? 0).toBeGreaterThan(0);
        expect(term.queries).toBeUndefined();
      }
    }
  });

  it("gives every text term at least one query and no Google place types", () => {
    for (const category of CATEGORIES) {
      for (const term of category.terms) {
        if (term.mode !== "text") continue;
        expect(term.queries?.length ?? 0).toBeGreaterThan(0);
        expect(term.googleTypes).toBeUndefined();
      }
    }
  });

  it("uses only snake_case Google type strings — Table A has no camelCase", () => {
    for (const category of CATEGORIES) {
      for (const type of category.terms.flatMap((t) => t.googleTypes ?? [])) {
        expect(type).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it("pays for reviews on competition and not on cheap demand anchors", () => {
    for (const category of CATEGORIES.filter((c) => c.side === "competition")) {
      expect(category.fields).toBe("ENTERPRISE_ATMOSPHERE");
    }
    expect(getCategory("schools")?.fields).toBe("PRO");
    expect(getCategory("workplaces")?.fields).toBe("PRO");
    expect(getCategory("apartments")?.fields).toBe("PRO");
  });

  it("gives every demand category an anchor weight and no competition category one", () => {
    for (const category of CATEGORIES) {
      if (category.side === "demand") {
        expect(category.anchorWeight).toBeGreaterThan(0);
      } else {
        expect(category.anchorWeight).toBeUndefined();
      }
    }
  });

  it("keeps ids that are already persisted in scan rows", () => {
    const ids = CATEGORIES.map((c) => c.id).sort();
    expect(ids).toEqual([
      "apartments",
      "badminton",
      "basketball",
      "colleges",
      "cricket",
      "it-companies",
      "kindergarten",
      "pickleball",
      "running-track",
      "schools",
      "squash",
      "table-tennis",
      "tennis",
      "turf-sports",
      "volleyball",
      "workplaces",
    ]);
  });
});

describe("presets", () => {
  it("defines the three presets the client asked for", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["quick-check", "standard-scan", "full-sweep"]);
  });

  it("names only categories that exist", () => {
    for (const preset of PRESETS) {
      expect(unknownCategoryIds(preset.categoryIds)).toEqual([]);
    }
  });

  it("makes Full sweep every category", () => {
    expect(categoriesForPreset("full-sweep")).toHaveLength(CATEGORIES.length);
  });

  it("returns nothing for an unknown preset rather than throwing", () => {
    expect(getPreset("no-such-preset")).toBeUndefined();
    expect(categoriesForPreset("no-such-preset")).toEqual([]);
  });
});

describe("resolution", () => {
  it("returns categories in taxonomy order regardless of the order asked for", () => {
    expect(resolveCategories(["schools", "turf-sports"]).map((c) => c.id)).toEqual([
      "turf-sports",
      "schools",
    ]);
  });

  it("silently drops unknown ids but reports them separately", () => {
    expect(resolveCategories(["turf-sports", "nope"]).map((c) => c.id)).toEqual(["turf-sports"]);
    expect(unknownCategoryIds(["turf-sports", "nope"])).toEqual(["nope"]);
  });

  it("flattens a selection into executable terms carrying their category context", () => {
    const terms = resolveTerms(["turf-sports"]);
    expect(terms).toHaveLength(2);
    expect(terms[0]).toMatchObject({
      categoryId: "turf-sports",
      side: "competition",
      fields: "ENTERPRISE_ATMOSPHERE",
    });
  });

  it("resolves nothing for an empty selection", () => {
    expect(resolveTerms([])).toEqual([]);
  });
});

describe("isSportMismatch", () => {
  it("filters a basketball club from football turf results", () => {
    expect(isSportMismatch("Indiranagar Basketball Club", "turf-sports")).toBe(true);
  });

  it("keeps a football turf in football turf results", () => {
    expect(isSportMismatch("Turf Arena Football", "turf-sports")).toBe(false);
  });

  it("filters a tennis court from table-tennis results", () => {
    expect(isSportMismatch("City Tennis Court", "table-tennis")).toBe(true);
  });

  it("filters a table tennis academy from tennis results", () => {
    expect(isSportMismatch("Table Tennis Academy", "tennis")).toBe(true);
  });

  it("keeps a tennis club in tennis results", () => {
    expect(isSportMismatch("City Tennis Club", "tennis")).toBe(false);
  });

  it("keeps a generic sports complex (no sport keyword)", () => {
    expect(isSportMismatch("Sports Arena & Complex", "turf-sports")).toBe(false);
  });

  it("keeps a place whose name matches the target sport even if others appear", () => {
    expect(isSportMismatch("Cricket & Football Turf", "turf-sports")).toBe(false);
    expect(isSportMismatch("Cricket & Football Turf", "cricket")).toBe(false);
  });

  it("returns false for demand categories (no signals defined)", () => {
    expect(isSportMismatch("Basketball Club", "schools")).toBe(false);
  });

  it("filters a cricket ground from badminton results", () => {
    expect(isSportMismatch("Salem Cricket Ground", "badminton")).toBe(true);
  });

  it("filters a badminton court from squash results", () => {
    expect(isSportMismatch("ABC Badminton Court", "squash")).toBe(true);
  });

  it("filters a volleyball court from basketball results", () => {
    expect(isSportMismatch("City Volleyball Arena", "basketball")).toBe(true);
  });

  it("filters a football turf from badminton results", () => {
    expect(isSportMismatch("XYZ Football Turf", "badminton")).toBe(true);
  });

  it("filters a cricket nets place from tennis results", () => {
    expect(isSportMismatch("Chennai Cricket Nets", "tennis")).toBe(true);
  });

  it("filters a running track from volleyball results", () => {
    expect(isSportMismatch("City Athletics Track", "volleyball")).toBe(true);
  });

  it("keeps a pickleball court in pickleball results", () => {
    expect(isSportMismatch("ABC Pickleball Arena", "pickleball")).toBe(false);
  });

  it("keeps a squash court in squash results", () => {
    expect(isSportMismatch("Metro Squash Court", "squash")).toBe(false);
  });

  it("filters a five-a-side turf from cricket results", () => {
    expect(isSportMismatch("Five A Side Arena", "cricket")).toBe(true);
  });

  it("filters a volley ball court from pickleball results", () => {
    expect(isSportMismatch("Volley Ball Club", "pickleball")).toBe(true);
  });

  it("filters a joggers park from basketball results", () => {
    expect(isSportMismatch("Joggers Park Running Track", "basketball")).toBe(true);
  });
});

describe("shouldFilterCompetition across all categories", () => {
  const allCompetition = CATEGORIES.filter((c) => c.side === "competition").map((c) => c.id);

  it("filters sporting_goods_store for every competition category", () => {
    for (const catId of allCompetition) {
      expect(shouldFilterCompetition("sporting_goods_store", null, "Sports Shop", catId)).toBe(true);
    }
  });

  it("filters hotel for every competition category", () => {
    for (const catId of allCompetition) {
      expect(shouldFilterCompetition("hotel", null, "Grand Hotel & Sports", catId)).toBe(true);
    }
  });

  it("filters display name 'store' for every competition category", () => {
    for (const catId of allCompetition) {
      expect(shouldFilterCompetition("some_unknown_type", "Store", "ABC Sporting Goods", catId)).toBe(true);
    }
  });

  it("filters display name 'contractor' for every competition category", () => {
    for (const catId of allCompetition) {
      expect(shouldFilterCompetition(null, "Contractor", "XYZ Turf Installers", catId)).toBe(true);
    }
  });

  it("keeps a legitimate sports facility for its own category", () => {
    expect(shouldFilterCompetition(null, null, "City Badminton Court", "badminton")).toBe(false);
    expect(shouldFilterCompetition(null, null, "Metro Squash Arena", "squash")).toBe(false);
    expect(shouldFilterCompetition(null, null, "Downtown Pickleball Club", "pickleball")).toBe(false);
    expect(shouldFilterCompetition(null, null, "Cricket Nets Zone", "cricket")).toBe(false);
    expect(shouldFilterCompetition(null, null, "Volleyball Arena", "volleyball")).toBe(false);
  });

  it("filters cross-sport results via name signals", () => {
    expect(shouldFilterCompetition(null, null, "Cricket Academy", "badminton")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Football Turf XYZ", "tennis")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Badminton Club", "volleyball")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Basketball Arena", "cricket")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Tennis Court", "pickleball")).toBe(true);
  });

  it("filters cross-category Google type (athletic_field under non-running-track)", () => {
    expect(shouldFilterCompetition("athletic_field", null, "City Ground", "turf-sports")).toBe(true);
    expect(shouldFilterCompetition("athletic_field", null, "City Ground", "badminton")).toBe(true);
    expect(shouldFilterCompetition("athletic_field", null, "City Ground", "running-track")).toBe(false);
  });

  it("filters infrastructure companies by name", () => {
    expect(shouldFilterCompetition(null, null, "Michezo Sports Infrastructure Pvt Ltd", "turf-sports")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Anivi Sports Infrastructure Company", "turf-sports")).toBe(true);
    expect(shouldFilterCompetition(null, null, "XYZ Infrastructure Private Limited", "badminton")).toBe(true);
    expect(shouldFilterCompetition(null, null, "ABC Construction Pvt Ltd", "cricket")).toBe(true);
  });

  it("filters manufacturers and suppliers by name", () => {
    expect(shouldFilterCompetition(null, null, "XYZ Turf Manufacturer", "turf-sports")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Cricket Net Manufacturing Co", "cricket")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Sports Equipment Supplier", "badminton")).toBe(true);
    expect(shouldFilterCompetition(null, null, "ABC Flooring Distributor", "tennis")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Sports Material Stockist", "volleyball")).toBe(true);
  });

  it("filters equipment shops and sports goods stores by name", () => {
    expect(shouldFilterCompetition(null, null, "XYZ Sports Goods", "badminton")).toBe(true);
    expect(shouldFilterCompetition(null, null, "ABC Sports Equipment Store", "tennis")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Cricket Equipment Shop", "cricket")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Equipment Dealer XYZ", "squash")).toBe(true);
  });

  it("filters real estate and renovation businesses by name", () => {
    expect(shouldFilterCompetition(null, null, "Cricket Heights Real Estate", "cricket")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Turf Landscaping Services", "turf-sports")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Sports Furnishing Co", "badminton")).toBe(true);
  });

  it("keeps legitimate venues that happen to have common words", () => {
    expect(shouldFilterCompetition(null, null, "City Turf Arena", "turf-sports")).toBe(false);
    expect(shouldFilterCompetition(null, null, "Shuttle Sports Academy", "badminton")).toBe(false);
    expect(shouldFilterCompetition(null, null, "Metro Tennis Club", "tennis")).toBe(false);
    expect(shouldFilterCompetition(null, null, "XYZ Sports Complex", "basketball")).toBe(false);
    expect(shouldFilterCompetition(null, null, "Box Cricket Zone", "cricket")).toBe(false);
  });

  it("filters grocery_store and market types for all categories", () => {
    for (const catId of CATEGORIES.filter((c) => c.side === "competition").map((c) => c.id)) {
      expect(shouldFilterCompetition("grocery_store", null, "Fresh Mart", catId)).toBe(true);
      expect(shouldFilterCompetition("market", null, "City Market", catId)).toBe(true);
    }
  });

  it("filters additional business entities (traders, enterprises, consultancy)", () => {
    expect(shouldFilterCompetition(null, null, "ABC Traders Sports", "badminton")).toBe(true);
    expect(shouldFilterCompetition(null, null, "XYZ Sports Enterprises", "tennis")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Sports Consultancy Firm", "cricket")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Sports Industries Pvt", "volleyball")).toBe(true);
    expect(shouldFilterCompetition(null, null, "XYZ Holdings Sports", "squash")).toBe(true);
  });

  it("filters non-sports venues by name (hotel, hospital, temple, restaurant)", () => {
    expect(shouldFilterCompetition(null, null, "Hotel Sports Club", "turf-sports")).toBe(true);
    expect(shouldFilterCompetition(null, null, "City Hospital Sports Ground", "cricket")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Temple Sports Academy", "badminton")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Restaurant Sports Bar", "basketball")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Residency Tennis Club", "tennis")).toBe(true);
    expect(shouldFilterCompetition(null, null, "XYZ Apartment Sports", "volleyball")).toBe(true);
  });

  it("filters names with zero sport/facility keywords", () => {
    expect(shouldFilterCompetition(null, null, "XYZ Pvt Ltd", "turf-sports")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Random Place", "badminton")).toBe(true);
    expect(shouldFilterCompetition(null, null, "ABC Services", "tennis")).toBe(true);
    expect(shouldFilterCompetition(null, null, "Metro Solutions", "cricket")).toBe(true);
  });

  it("keeps venues with sport-related Google types even with generic names", () => {
    expect(shouldFilterCompetition("sports_complex", null, "The XYZ", "badminton")).toBe(false);
    expect(shouldFilterCompetition("sports_club", null, "Metro Plus", "tennis")).toBe(false);
    expect(shouldFilterCompetition("stadium", null, "City One", "cricket")).toBe(false);
    expect(shouldFilterCompetition("fitness_center", null, "Iron Hub", "basketball")).toBe(false);
    expect(shouldFilterCompetition("gym", null, "The Den", "volleyball")).toBe(false);
  });

  it("still filters allowed types if they belong to a different category", () => {
    expect(shouldFilterCompetition("athletic_field", null, "City Field", "badminton")).toBe(true);
    expect(shouldFilterCompetition("athletic_field", null, "City Field", "running-track")).toBe(false);
  });
});

describe("publicTaxonomy", () => {
  it("ships every category and preset to the browser", () => {
    const shipped = publicTaxonomy();
    expect(shipped.categories).toHaveLength(CATEGORIES.length);
    expect(shipped.presets).toHaveLength(PRESETS.length);
  });

  it("does not ship Google search strings", () => {
    const serialised = JSON.stringify(publicTaxonomy());
    expect(serialised).not.toContain("box cricket");
  });

  it("reports the term count each category contributes to the estimate", () => {
    const turf = publicTaxonomy().categories.find((c) => c.id === "turf-sports");
    expect(turf?.termCount).toBe(2);
  });
});
