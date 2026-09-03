import "server-only";

import { canAccessAllScans, type ScoutProfile } from "@/lib/scout/identity";
import { UNKNOWN_OPERATING_WINDOW, type OperatingWindow } from "@/lib/scout/places/normalise";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getScanResult } from "@/lib/scout/places/scanResult";
import { ANALYSED_MARKER_THEME, reviewThemeLabel } from "@/lib/scout/scoring";
import { sanitiseSurveyorInputs } from "@/lib/scout/scoring/checklist";
import type { ScoreResult } from "@/lib/scout/scoring/types";
import { parseSweepDocument } from "@/lib/scout/sweep/grid";

import { defaultBlockState, sanitiseBlockState, type ReportBlockState } from "./blocks";
import { reportBrand } from "./brand";
import type { ReportInput, ReportThemeInput } from "./document";
import { getComplaintThemeRows, getReportDraft, getReportScanFacts } from "./repository";
import { fetchStaticMap } from "./staticMapServer";

/**
 * Everything the report renderer needs, gathered once.
 *
 * The document builder is pure and takes plain data, so this is the only place
 * that touches the database — which is what lets a golden test drive the whole
 * renderer from a fixture and lets a regeneration in a year read an archived
 * scan without a live Google key.
 *
 * ## Why the figures are read, never recomputed
 *
 * Counts, review totals and the average rating come from `getScanResult`, the
 * same function every screen reads. Saturation comes out of the stored
 * `ScoreResult`'s audit trail (`saturationFigures`). Nothing here re-derives a
 * number that is printed elsewhere: two implementations of the same figure
 * disagree eventually, and the first place anybody notices is a report where
 * the headline and the justification underneath it contradict each other.
 */

export interface AssembleOptions {
  /** Overrides the saved draft's composition — used by "preview this state". */
  readonly blocks?: ReportBlockState;
  readonly reportId?: string | null;
  readonly version?: number;
  readonly generatedAt?: Date;
  readonly preparedBy?: string;
  /** Skip the Static Maps call. Tests and previews do not need a live fetch. */
  readonly skipMap?: boolean;
}

function operatingWindowOf(raw: Record<string, unknown> | null): OperatingWindow {
  if (!raw) return UNKNOWN_OPERATING_WINDOW;
  return { ...UNKNOWN_OPERATING_WINDOW, ...(raw as unknown as OperatingWindow) };
}

/**
 * Assemble the input, or `null` when the caller may not read the scan.
 *
 * `null` rather than a thrown error, and 404 rather than 403 at the route —
 * the same rule Phase 1 set, for the same reason: a 403 confirms the id exists.
 */
export async function assembleReportInput(
  author: ScoutProfile,
  scanId: string,
  options: AssembleOptions = {},
): Promise<ReportInput | null> {
  const scan = await getScan(scanId);
  if (!scan) return null;
  if (scan.ownerId !== author.userId && !canAccessAllScans(author)) return null;

  const [result, row, draft] = await Promise.all([
    getScanResult(scanId),
    getReportScanFacts(scanId),
    getReportDraft(scanId),
  ]);

  if (!result) return null;

  const score = (row?.scoreBreakdown as unknown as ScoreResult | null) ?? null;
  const blocks = options.blocks ?? draft?.includedBlocks ?? defaultBlockState();

  const competition = result.places.filter((p) => p.side === "competition");
  const themes = await loadThemes(competition.map((p) => p.placeId));

  const map = options.skipMap
    ? null
    : await fetchStaticMap({
        centre: result.centre,
        radiusM: result.radiusM,
        areaLabel: result.areaLabel,
        facilities: competition.map((p) => p.location),
        demand: result.places.filter((p) => p.side === "demand").map((p) => p.location),
      });

  return {
    scanId,
    reportId: options.reportId ?? null,
    version: options.version ?? 1,
    areaLabel: result.areaLabel,
    address: row?.address ?? null,
    customerName: row?.customerName ?? null,
    preparedBy: options.preparedBy ?? author.displayName,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    dataCollectedAt: row?.scannedAt ? row.scannedAt.toISOString() : null,
    centre: result.centre,
    radiusM: result.radiusM,

    places: result.places.map((place) => {
      const window = operatingWindowOf(place.operatingWindow);
      return {
        placeId: place.placeId,
        name: place.name,
        side: place.side,
        categories: place.categories,
        distanceM: place.distanceMRounded,
        rating: place.rating,
        reviewCount: place.reviewCount,
        priceLevel: place.priceLevel,
        opensEarly: window.opensEarly === true,
        closesLate: window.closesLate === true,
        earliestOpenMinute: window.earliestOpenMinute ?? null,
        latestCloseMinute: window.latestCloseMinute ?? null,
        alwaysOpen: window.alwaysOpen === true,
      };
    }),
    categories: result.categories.map((category) => ({
      categoryId: category.categoryId,
      label: category.label,
      side: category.side,
      count: category.count,
      saturated: category.saturated,
      reviewTotal: category.reviewTotal,
      avgRating: category.avgRating,
      nearestM: category.nearest?.distanceM ?? null,
      nearestName: category.nearest?.name ?? null,
    })),
    competitionCount: result.competitionCount,
    demandCount: result.demandCount,
    reviewTotal: result.reviewTotal,
    avgRating: result.avgRating,
    anySaturated: result.saturation.anySaturated,

    score,
    surveyorInputs: sanitiseSurveyorInputs(row?.surveyorInputs),
    fieldNotes: draft?.fieldNotes || row?.fieldNotes || null,
    sweep: parseSweepDocument(row?.sweep ?? null),

    map,
    themes,
    blocks: sanitiseBlockState(blocks),
    brand: reportBrand(),
  };
}

/**
 * Complaint themes and their verbatim quotes, for the competition section.
 *
 * Only negative themes are printed: the section is "what customers complain
 * about", and a positive theme in that list would be quoted out of its own
 * meaning. The **marker row** is counted separately — it records that a venue
 * *was* analysed, so "read the reviews and found nothing" stays distinguishable
 * from "never read them", which are different findings and read very
 * differently to a land owner.
 */
async function loadThemes(
  googlePlaceIds: readonly string[],
): Promise<ReportInput["themes"]> {
  if (googlePlaceIds.length === 0) {
    return { analysed: false, reviewedCompetitors: 0, items: [] };
  }

  const rows = await getComplaintThemeRows(googlePlaceIds);

  const analysedVenues = new Set<string>();
  const items: ReportThemeInput[] = [];

  for (const row of rows) {
    analysedVenues.add(row.googlePlaceId);
    if (row.theme === ANALYSED_MARKER_THEME) continue;
    if (row.sentiment !== "negative") continue;

    const evidence = Array.isArray(row.evidence) ? (row.evidence as Array<{ quote?: unknown }>) : [];
    const quotes = evidence
      .map((entry) => (typeof entry?.quote === "string" ? entry.quote.trim() : null))
      .filter((quote): quote is string => Boolean(quote))
      .slice(0, 2);

    items.push({
      theme: row.theme,
      label: reviewThemeLabel(row.theme),
      venueName: row.venueName,
      mentionCount: row.mentionCount,
      quotes,
    });
  }

  return {
    analysed: analysedVenues.size > 0,
    reviewedCompetitors: analysedVenues.size,
    items,
  };
}

