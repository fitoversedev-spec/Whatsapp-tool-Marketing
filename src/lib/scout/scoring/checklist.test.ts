/**
 * The checklist is a persisted contract, so this test pins it.
 *
 * `scans.surveyor_inputs` is keyed by these ids. Renaming one orphans every
 * survey already recorded — the same rule the taxonomy lives under, for the
 * same reason. Phases 4, 5 and 6 render this list generically; if it changes
 * shape, they need to know before the change ships, not after a report prints
 * a field nobody recognises.
 */

import { describe, expect, it } from "vitest";

import {
  CHECKLIST_FIELD_IDS,
  CHECKLIST_GROUPS,
  CHECKLIST_MAX_RATING,
  CHECKLIST_VERSION,
  SURVEYOR_CHECKLIST,
  checklistFieldsInGroup,
  getChecklistField,
  sanitiseSurveyorInputs,
} from "./checklist";

/** The client's D6 answer, in order. Changing this list is a version bump. */
const EXPECTED_IDS = [
  "road-frontage",
  "parking",
  "visibility",
  "approach-road",
  "distance-to-transit",
  "power-supply",
  "water",
  "drainage",
  "slope-levelling",
  "soil-ground",
  "flood-history",
  "boundary",
  "adjacent-residences",
  "evening-play-restrictions",
];

describe("the surveyor checklist", () => {
  it("is the fourteen fields the client specified, with stable ids", () => {
    expect(CHECKLIST_FIELD_IDS).toEqual(EXPECTED_IDS);
    expect(SURVEYOR_CHECKLIST).toHaveLength(14);
    expect(CHECKLIST_VERSION).toBe("1.0.0");
  });

  it("splits into the client's four groups, all non-empty", () => {
    expect(CHECKLIST_GROUPS.map((g) => g.id)).toEqual([
      "access-commercial",
      "utilities",
      "land-condition",
      "neighbours-restrictions",
    ]);
    for (const group of CHECKLIST_GROUPS) {
      expect(checklistFieldsInGroup(group.id).length).toBeGreaterThan(0);
    }
    const grouped = CHECKLIST_GROUPS.flatMap((g) => checklistFieldsInGroup(g.id));
    expect(grouped).toHaveLength(SURVEYOR_CHECKLIST.length);
  });

  it("gives every field four rating anchors, in worst-to-best order", () => {
    for (const field of SURVEYOR_CHECKLIST) {
      expect(field.anchors, field.id).toHaveLength(CHECKLIST_MAX_RATING + 1);
      for (const anchor of field.anchors) {
        expect(anchor.length, `${field.id} anchor is empty`).toBeGreaterThan(2);
      }
      expect(field.help.length, `${field.id} has no help text`).toBeGreaterThan(10);
      expect(new Set(field.anchors).size, `${field.id} repeats an anchor`).toBe(4);
    }
  });

  it("looks a field up by id and returns undefined for one that never existed", () => {
    expect(getChecklistField("parking")?.label).toBe("Parking");
    expect(getChecklistField("helipad")).toBeUndefined();
  });
});

describe("sanitising what a surveyor submitted", () => {
  it("keeps well-formed ratings", () => {
    expect(sanitiseSurveyorInputs({ parking: 0, visibility: 3 })).toEqual({
      parking: 0,
      visibility: 3,
    });
  });

  it("drops unknown field ids rather than storing them", () => {
    expect(sanitiseSurveyorInputs({ parking: 2, helipad: 3 })).toEqual({ parking: 2 });
  });

  it("drops out-of-range and non-integer values rather than clamping them", () => {
    // Clamping would score a 7 as a 3 — an observation nobody made.
    expect(sanitiseSurveyorInputs({ parking: 7, water: -1, drainage: 1.5 })).toEqual({});
  });

  it("drops nulls, so an unanswered field stays absent rather than becoming zero", () => {
    expect(sanitiseSurveyorInputs({ parking: null, water: undefined, drainage: "2" })).toEqual({});
  });

  it("survives junk input without throwing", () => {
    expect(sanitiseSurveyorInputs(null)).toEqual({});
    expect(sanitiseSurveyorInputs("nonsense")).toEqual({});
    expect(sanitiseSurveyorInputs(42)).toEqual({});
  });
});
