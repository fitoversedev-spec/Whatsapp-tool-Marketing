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
  PRESETS,
  publicTaxonomy,
  resolveCategories,
  resolveTerms,
  unknownCategoryIds,
} from "./taxonomy";

describe("taxonomy structure", () => {
  it("has the seven competition and five demand categories the client specified", () => {
    expect(CATEGORIES.filter((c) => c.side === "competition")).toHaveLength(7);
    expect(CATEGORIES.filter((c) => c.side === "demand")).toHaveLength(5);
  });

  it("covers all fourteen sport formats from CLIENT-INPUTS D3", () => {
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
        "skating-rink",
        "squash",
        "swimming-pool",
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
    // Score component 3 is built from competitor review volume, so competition
    // must be Atmosphere. Paying Atmosphere prices to count bus stops would
    // roughly double the cost of a Full sweep for nothing.
    for (const category of CATEGORIES.filter((c) => c.side === "competition")) {
      expect(category.fields).toBe("ENTERPRISE_ATMOSPHERE");
    }
    expect(getCategory("education")?.fields).toBe("PRO");
    expect(getCategory("transit")?.fields).toBe("PRO");
    // Lifestyle is the exception: `priceLevel` is the free affluence proxy and
    // it is an Enterprise field.
    expect(getCategory("lifestyle")?.fields).toBe("ENTERPRISE");
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
    // Renaming any of these orphans historical scans. Change the label instead.
    const ids = CATEGORIES.map((c) => c.id).sort();
    expect(ids).toEqual([
      "adjacent-fitness",
      "court-sports",
      "cricket",
      "education",
      "lifestyle",
      "racquet-sports",
      "residential",
      "track-wheels",
      "transit",
      "turf-sports",
      "water",
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

  it("keeps Quick check at roughly six terms and Full sweep at roughly five times that", () => {
    const quick = categoriesForPreset("quick-check").flatMap((c) => c.terms).length;
    const full = categoriesForPreset("full-sweep").flatMap((c) => c.terms).length;
    expect(quick).toBe(6);
    expect(full / quick).toBeGreaterThan(4);
    expect(full / quick).toBeLessThan(7);
  });

  it("returns nothing for an unknown preset rather than throwing", () => {
    expect(getPreset("no-such-preset")).toBeUndefined();
    expect(categoriesForPreset("no-such-preset")).toEqual([]);
  });
});

describe("resolution", () => {
  it("returns categories in taxonomy order regardless of the order asked for", () => {
    expect(resolveCategories(["education", "turf-sports"]).map((c) => c.id)).toEqual([
      "turf-sports",
      "education",
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

describe("publicTaxonomy", () => {
  it("ships every category and preset to the browser", () => {
    const shipped = publicTaxonomy();
    expect(shipped.categories).toHaveLength(CATEGORIES.length);
    expect(shipped.presets).toHaveLength(PRESETS.length);
  });

  it("does not ship Google search strings", () => {
    // Not secret, but they are our tuning and there is no reason to publish
    // the exact queries that produce a competitor list.
    const serialised = JSON.stringify(publicTaxonomy());
    expect(serialised).not.toContain("box cricket");
    expect(serialised).not.toContain("swimming_pool");
  });

  it("reports the term count each category contributes to the estimate", () => {
    const turf = publicTaxonomy().categories.find((c) => c.id === "turf-sports");
    expect(turf?.termCount).toBe(2);
  });
});
