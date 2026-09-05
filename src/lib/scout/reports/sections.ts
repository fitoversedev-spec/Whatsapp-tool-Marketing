/**
 * Which of the nine sections a composition prints.
 *
 * ## How the D5 checkboxes map onto the printed sections
 *
 * The studio's nine **blocks** (`blocks.ts`) and the report's nine **sections**
 * are not the same nine things, and pretending they were would have meant
 * renaming block ids — which silently drops the block from every report already
 * composed (`docs/PHASE-4-HANDOFF.md` §7). The mapping is therefore explicit:
 *
 * | Section | Printed when | Trimmed by |
 * |---|---|---|
 * | 1 Cover | always (`header` is `alwaysOn`) | `stat-cards` removes the four-up KPI strip |
 * | 2 Verdict | the scan is scored **and** `score` is on | — |
 * | 3 The catchment | always | `saturation` removes the saturation figure, not the section |
 * | 4 Competition | always | — |
 * | 5 Demand anchors | always | `count-table` removes the count summary table, not the section |
 * | 6 Static map | `map` is on **and** a map could actually be fetched | — |
 * | 7 Marked open spaces | `sweep` is on **and** cells were marked | — |
 * | 8 Surveyor observations | `field-notes` is on, or a survey was answered | — |
 * | 9 Limitations | always (`limitations` is `alwaysOn`) | — |
 *
 * ## The one deviation from the Phase 6 brief, stated plainly
 *
 * The brief says "sections 1–5 are always present" and that Phase 4 enforces
 * it. Phase 4 in fact marks only `header` and `limitations` as `alwaysOn`, and
 * an integration test pins `count-table: false` as a legal saved state. Rather
 * than change a shipped contract, sections 3, 4 and 5 are unconditional here
 * and the two toggles that touch them only trim a table inside them. **Section
 * 2 is the exception**: turning `score` off removes the verdict page, because
 * there is no meaningful verdict page with the score taken out of it, and a
 * report composed without a score is a real document — it is what v16 produced
 * for every scan. `docs/PHASE-6-HANDOFF.md` records this for the client to
 * settle.
 *
 * What is *not* negotiable, and is enforced by type and by test: when section 2
 * is printed it carries all five components. There is no composition that
 * prints a bare number.
 */

import type { ReportBlockState } from "./blocks";
import type { ReportSectionId } from "./types";

export interface SectionAvailability {
  readonly scored: boolean;
  readonly mapAvailable: boolean;
  readonly sweepHasMarks: boolean;
  readonly hasSurveyorContent: boolean;
  readonly hasSportsAreas: boolean;
  readonly hasAiSummary: boolean;
  readonly hasSuggestions: boolean;
}

const ORDER: readonly ReportSectionId[] = [
  "cover",
  "verdict",
  "catchment",
  "competition",
  "demand",
  "sportsAreas",
  "aiSummary",
  "suggestions",
  "map",
  "sweep",
  "observations",
  "limitations",
];

/** Sections no composition can remove. */
export const UNCONDITIONAL_SECTIONS: readonly ReportSectionId[] = [
  "cover",
  "catchment",
  "competition",
  "demand",
  "limitations",
];

export function sectionsFor(
  blocks: ReportBlockState,
  available: SectionAvailability,
): ReportSectionId[] {
  const on = (id: string) => blocks[id] === true;

  return ORDER.filter((section) => {
    switch (section) {
      case "verdict":
        return available.scored && on("score");
      case "map":
        return on("map") && available.mapAvailable;
      case "sportsAreas":
        return on("sports-areas") && available.hasSportsAreas;
      case "aiSummary":
        return on("ai-summary") && available.hasAiSummary;
      case "suggestions":
        return on("suggestions") && available.hasSuggestions;
      case "sweep":
        return on("sweep") && available.sweepHasMarks;
      case "observations":
        return available.hasSurveyorContent;
      default:
        return true;
    }
  });
}
