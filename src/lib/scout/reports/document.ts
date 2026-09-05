/**
 * `buildReportDocument` — plain scan data in, a fully resolved
 * `ReportDocument` out.
 *
 * **Pure.** No database, no clock, no environment. `generatedAt` is passed in
 * so the golden files are a function of the input and nothing else, and so a
 * report regenerated from an archived scan reproduces the document it printed
 * the first time rather than one stamped with today's date.
 *
 * ## The rules this function is responsible for
 *
 * - Every count goes through `atLeast()`, so a truncated search reads "at
 *   least 18" wherever it appears.
 * - The verdict section is built from `ScoreResult.components` or not at all.
 * - The saturation figure never appears without `SATURATION_METHOD_NOTE` beside
 *   it and the benchmark's **sample count** in the same sentence.
 * - `POPULATION_LIMITATION_TEXT` is the first paragraph of the limitations
 *   section, verbatim, and is the only place in the document where population
 *   vocabulary appears at all.
 * - Nothing states or implies a financial return. There is no currency symbol
 *   in any string this module produces.
 */

import {
  POPULATION_LIMITATION_TEXT,
  SATURATION_METHOD_NOTE,
  benchmarkSampleCaveat,
  populationLimitations,
} from "@/lib/scout/census/disclosure";
import {
  atLeast,
  confidenceLabel,
  formatCount,
  formatDistance,
  formatFullDate,
  formatRadius,
  formatRating,
  verdictLabel,
  verdictTone,
} from "@/lib/scout/display/format";
import { catchmentAreaKm2, saturationFigures, saturationStanding } from "@/lib/scout/display/saturation";
import {
  CHECKLIST_GROUPS,
  CHECKLIST_MAX_RATING,
  CHECKLIST_VERSION,
  SURVEYOR_CHECKLIST,
} from "@/lib/scout/scoring/checklist";
import type { ScoreResult } from "@/lib/scout/scoring/types";
import { markedCells, sweepStatusLabel, type SweepDocument } from "@/lib/scout/sweep/grid";

import type { ReportBlockState } from "./blocks";
import { reportBrand, type ReportBrand } from "./brand";
import { buildObservations, OBSERVATIONS_NOTE } from "./observations";
import { sectionsFor } from "./sections";
import type {
  AiSummarySection,
  CatchmentAnchorRow,
  CompetitionSection,
  CompetitorCategory,
  CompetitorRow,
  CountTableRow,
  DemandSection,
  MapSection,
  ObservationsSection,
  ReportDocument,
  ReportStat,
  SportsAreaRow,
  SportsAreasSection,
  SuggestionsSection,
  SweepSection,
  VerdictComponent,
  VerdictSection,
} from "./types";

/* ------------------------------------------------------------------ input */

export interface ReportPlaceInput {
  readonly placeId: string;
  readonly name: string;
  readonly side: "competition" | "demand";
  readonly categories: readonly string[];
  readonly distanceM: number;
  readonly rating: number | null;
  readonly reviewCount: number | null;
  readonly priceLevel: number | null;
  readonly opensEarly: boolean;
  readonly closesLate: boolean;
  readonly earliestOpenMinute: number | null;
  readonly latestCloseMinute: number | null;
  readonly alwaysOpen: boolean;
}

export interface ReportCategoryInput {
  readonly categoryId: string;
  readonly label: string;
  readonly side: "competition" | "demand";
  readonly count: number;
  readonly saturated: boolean;
  readonly reviewTotal: number;
  readonly avgRating: number | null;
  readonly nearestM: number | null;
  readonly nearestName: string | null;
}

export interface ReportThemeInput {
  readonly theme: string;
  readonly label: string;
  readonly venueName: string;
  readonly mentionCount: number;
  readonly quotes: readonly string[];
}

export interface ReportInput {
  readonly scanId: string;
  readonly reportId: string | null;
  readonly version: number;
  readonly areaLabel: string;
  readonly address: string | null;
  readonly customerName: string | null;
  readonly preparedBy: string;
  /** ISO-8601. Fixed by the caller — this module never reads a clock. */
  readonly generatedAt: string;
  readonly dataCollectedAt: string | null;
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly radiusM: number;

  readonly places: readonly ReportPlaceInput[];
  readonly categories: readonly ReportCategoryInput[];
  readonly competitionCount: number;
  readonly demandCount: number;
  readonly reviewTotal: number;
  readonly avgRating: number | null;
  readonly anySaturated: boolean;

  readonly score: ScoreResult | null;
  readonly surveyorInputs: Readonly<Record<string, number>>;
  readonly fieldNotes: string | null;
  readonly sweep: SweepDocument | null;

  /** Resolved by the server: an inlined image, or `null` for no map at all. */
  readonly map: MapSection | null;
  readonly themes: {
    readonly analysed: boolean;
    readonly reviewedCompetitors: number;
    readonly items: readonly ReportThemeInput[];
  };

  readonly blocks: ReportBlockState;
  readonly brand?: ReportBrand;

  readonly aiSummaryText?: string | null;
  readonly suggestionsText?: string | null;
}

/* ------------------------------------------------------------- formatting */

/** Google's price level, in words. No currency symbol appears anywhere. */
export function priceTierLabel(level: number | null): string {
  switch (level) {
    case 0:
      return "Free to enter";
    case 1:
      return "Budget";
    case 2:
      return "Mid";
    case 3:
      return "Premium";
    case 4:
      return "Top tier";
    default:
      return "Not listed";
  }
}

function clockLabel(minuteOfDay: number | null): string | null {
  if (minuteOfDay === null || !Number.isFinite(minuteOfDay)) return null;
  const h = Math.floor(minuteOfDay / 60) % 24;
  const m = Math.floor(minuteOfDay % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function operatingWindowLabel(place: ReportPlaceInput): string {
  if (place.alwaysOpen) return "Open 24 h";
  const open = clockLabel(place.earliestOpenMinute);
  const close = clockLabel(place.latestCloseMinute);
  if (!open || !close) return "Hours not listed";
  return `${open}–${close}${place.closesLate ? " · holds the evening peak" : ""}`;
}

function anchorRow(category: ReportCategoryInput): CatchmentAnchorRow {
  return {
    label: category.label,
    count: atLeast(category.count, category.saturated),
    nearestName: category.nearestName,
    nearestDistance: category.nearestM === null ? "—" : formatDistance(category.nearestM),
  };
}

/**
 * What the report says it does not cover — v16's list, extended.
 *
 * Exported because it is the **one** place in the document, other than the
 * client's disclaimer, where the words *revenue*, *return* and *payback* are
 * allowed to appear: here they are a denial. `reportContent.test.ts` bans that
 * vocabulary everywhere else by scanning the rendered HTML with these strings
 * removed, so the assertion stays absolute instead of becoming a list somebody
 * later adds one more exception to.
 */
export const REPORT_LIMITATION_BULLETS: readonly string[] = [
  "Actual footfall or occupancy. No public source measures it, and review volume is not a substitute for it.",
  "Land ownership, title, price, zoning or tenure.",
  "Facilities, clubs and grounds with no Google Business Profile. They exist and they are not counted here.",
  "Surface, drainage and climate suitability beyond what a surveyor could see on the day.",
  "Any projection of revenue, return, payback or operating cost. Those need commercial inputs this assessment does not gather.",
  "Traffic, travel time and access at peak hours. Distances here are straight-line.",
  "Anything a competitor does that Google does not list — pricing changes, private bookings, planned expansion.",
];

/* -------------------------------------------------------------- verdict */

function buildVerdict(score: ScoreResult): VerdictSection {
  const components: VerdictComponent[] = score.components.map((component) => ({
    id: component.id,
    label: component.label,
    points: component.included
      ? `${component.points.toFixed(1)} / ${component.available}`
      : "Excluded",
    fraction:
      component.included && component.available > 0
        ? Math.max(0, Math.min(1, component.points / component.available))
        : null,
    included: component.included,
    justification: component.justification,
    parts: component.parts.map((part) => ({ label: part.label, detail: part.detail })),
  }));

  return {
    total: String(score.totalRounded),
    outOf:
      score.pointsAvailable === 100
        ? "out of 100"
        : `out of 100, rescaled from the ${score.pointsAvailable} points that could be assessed`,
    verdictLabel: verdictLabel(score.verdict),
    verdictTone: verdictTone(score.verdict),
    statement: score.verdictStatement,
    basisLabel: score.basisLabel || null,
    confidenceLabel: confidenceLabel(score.confidence.level),
    confidenceReasons: [...score.confidence.reasons],
    modelVersionLine: `Scored under model v${score.modelVersion}, checklist v${score.checklistVersion}.`,
    components,
    hardFlags: score.hardFlags.map((f) => ({ code: f.code, message: f.message })),
    otherFlags: score.flags
      .filter((f) => f.severity !== "hard")
      .map((f) => ({ code: f.code, message: f.message })),
  };
}

/* ---------------------------------------------------------- competition */

const MAX_ROWS_PER_CATEGORY = 12;
const MAX_QUOTES_PER_THEME = 3;

function buildCompetition(input: ReportInput): CompetitionSection {
  const byCategory: CompetitorCategory[] = [];

  for (const category of input.categories) {
    if (category.side !== "competition") continue;
    const members = input.places
      .filter((p) => p.side === "competition" && p.categories.includes(category.categoryId))
      .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));

    const rows: CompetitorRow[] = members.slice(0, MAX_ROWS_PER_CATEGORY).map((place) => ({
      name: place.name,
      rating: formatRating(place.rating),
      reviews: place.reviewCount === null ? "—" : formatCount(place.reviewCount),
      distance: formatDistance(place.distanceM),
      window: operatingWindowLabel(place),
      priceTier: priceTierLabel(place.priceLevel),
    }));

    byCategory.push({
      categoryId: category.categoryId,
      label: category.label,
      countLine:
        `${atLeast(category.count, category.saturated)} found · ` +
        `${formatCount(category.reviewTotal)} reviews · ` +
        `average rating ${formatRating(category.avgRating)}`,
      rows,
      overflow: Math.max(0, members.length - rows.length),
    });
  }

  /* Themes, folded across venues: a complaint raised at four facilities is a
     market condition, one raised at a single facility is that facility. */
  const folded = new Map<
    string,
    { label: string; venues: Set<string>; mentions: number; quotes: Array<{ venue: string; quote: string }> }
  >();
  for (const item of input.themes.items) {
    const existing = folded.get(item.theme) ?? {
      label: item.label,
      venues: new Set<string>(),
      mentions: 0,
      quotes: [],
    };
    existing.venues.add(item.venueName);
    existing.mentions += item.mentionCount;
    for (const quote of item.quotes) {
      if (existing.quotes.length < MAX_QUOTES_PER_THEME) {
        existing.quotes.push({ venue: item.venueName, quote });
      }
    }
    folded.set(item.theme, existing);
  }

  const themes = [...folded.entries()]
    .map(([theme, value]) => ({
      theme,
      label: value.label,
      venueCount: value.venues.size,
      mentionCount: value.mentions,
      summary:
        `Raised at ${value.venues.size} of ${input.themes.reviewedCompetitors} facilities whose ` +
        `reviews were read, ${formatCount(value.mentions)} time${value.mentions === 1 ? "" : "s"}.`,
      quotes: value.quotes,
    }))
    .sort((a, b) => b.venueCount - a.venueCount || b.mentionCount - a.mentionCount);

  const themeState = !input.themes.analysed
    ? "Competitor reviews have not been read for this scan yet, so no complaint themes are reported. " +
      "That is different from reading them and finding none."
    : themes.length === 0
      ? "Competitor reviews were read and no complaint recurred often enough to report. That is a " +
        "finding: the incumbents are not obviously failing their customers on anything specific."
      : "Every quote below is reproduced verbatim from a public Google review and was checked to be a " +
        "literal extract of the review it is attributed to. Reviews are what customers chose to " +
        "write, not a survey of everyone who visited.";

  return {
    headline: `${atLeast(input.competitionCount, input.anySaturated)} Google-listed facilities inside ${formatRadius(input.radiusM)}`,
    caveat:
      "Google-listed only. A facility without a Google Business Profile does not appear here, and " +
      "informal or club-run grounds frequently do not have one. Counts are a floor, not a complete count.",
    categories: byCategory,
    themes,
    themeState,
  };
}

/* --------------------------------------------------------------- demand */

function buildDemand(input: ReportInput, countTableOn: boolean): DemandSection {
  const demandCategories = input.categories.filter((c) => c.side === "demand");

  const countTable: CountTableRow[] | null = countTableOn
    ? input.categories.map((c) => ({
        label: c.label,
        side: c.side === "competition" ? "Competition" : "Demand anchor",
        count: atLeast(c.count, c.saturated),
        reviews: c.reviewTotal > 0 ? formatCount(c.reviewTotal) : "—",
        nearest: c.nearestM === null ? "—" : formatDistance(c.nearestM),
      }))
    : null;

  return {
    headline: `${atLeast(input.demandCount, input.anySaturated)} demand anchors inside ${formatRadius(input.radiusM)}`,
    rows: demandCategories.map(anchorRow),
    countTable,
    distanceNote:
      "Distances are straight-line from the site pin. Road distance in Indian cities typically runs " +
      "1.2–1.4 times the straight line, so treat these as a lower bound on the journey.",
  };
}

/* ---------------------------------------------------------------- sweep */

function buildSweep(sweep: SweepDocument | null): SweepSection | null {
  if (!sweep) return null;
  const marked = markedCells(sweep.cells);
  if (marked.length === 0) return null;

  return {
    summary: `${marked.length} cell${marked.length === 1 ? "" : "s"} marked in the satellite sweep of this area.`,
    rows: marked.map((cell) => ({
      id: cell.id,
      status: sweepStatusLabel(cell.status),
      note: cell.note?.trim() || "—",
      coordinates: `${((cell.bounds.north + cell.bounds.south) / 2).toFixed(5)}, ${(
        (cell.bounds.east + cell.bounds.west) / 2
      ).toFixed(5)}`,
    })),
    caveat:
      "Marked from satellite imagery only, which is typically one to three years old. Ownership, " +
      "zoning, tenure and price are not covered by this sweep and require ground verification.",
  };
}

/* --------------------------------------------------------- observations */

function buildSurveyorSection(input: ReportInput, notesOn: boolean): ObservationsSection | null {
  const answers = input.surveyorInputs;
  const answered = SURVEYOR_CHECKLIST.filter((f) => typeof answers[f.id] === "number");
  const notes = notesOn ? (input.fieldNotes?.trim() || null) : null;
  if (answered.length === 0 && !notes) return null;

  const groups = CHECKLIST_GROUPS.map((group) => ({
    label: group.label,
    fields: SURVEYOR_CHECKLIST.filter(
      (f) => f.group === group.id && typeof answers[f.id] === "number",
    ).map((f) => {
      const rating = answers[f.id]!;
      return {
        label: f.label,
        rating: `${rating} / ${CHECKLIST_MAX_RATING}`,
        anchor: f.anchors[rating as 0 | 1 | 2 | 3] ?? "",
      };
    }),
  })).filter((g) => g.fields.length > 0);

  const hardFlags = input.score?.hardFlags ?? [];

  return {
    groups,
    answeredLine:
      answered.length === 0
        ? "No checklist field was answered for this site."
        : `${answered.length} of ${SURVEYOR_CHECKLIST.length} checklist fields answered, on checklist v${CHECKLIST_VERSION}. ` +
          `An unanswered field is left out rather than scored as zero — zero is the worst possible observation, not an absent one.`,
    fieldNotes: notes,
    hardFlagNote:
      hardFlags.length > 0
        ? `This site raised ${hardFlags.length} finding${hardFlags.length === 1 ? "" : "s"} the score reports whatever the total: ` +
          hardFlags.map((f) => f.message).join(" ")
        : null,
  };
}

/* --------------------------------------------------------- sportsAreas */

function buildSportsAreas(input: ReportInput): SportsAreasSection | null {
  const rows: SportsAreaRow[] = input.places
    .filter((p) => p.side === "competition")
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((p) => ({
      name: p.name,
      category: input.categories.find((c) => p.categories.includes(c.categoryId))?.label ?? "Sports facility",
      distance: formatDistance(p.distanceM),
      rating: formatRating(p.rating),
      reviews: p.reviewCount === null ? "—" : formatCount(p.reviewCount),
    }));
  if (rows.length === 0) return null;
  return {
    headline: `${rows.length} sports and fitness ${rows.length === 1 ? "facility" : "facilities"} found within ${formatRadius(input.radiusM)}`,
    rows,
  };
}

/* ------------------------------------------------------------- document */

export function buildReportDocument(input: ReportInput): ReportDocument {
  const brand = input.brand ?? reportBrand();
  const score = input.score;
  const blocks = input.blocks;
  const on = (id: string) => blocks[id] === true;

  const figures = score ? saturationFigures(score) : null;
  const standing = figures ? saturationStanding(figures) : null;
  const areaKm2 = catchmentAreaKm2(input.radiusM);

  const sweep = on("sweep") ? buildSweep(input.sweep) : null;
  const surveyor = buildSurveyorSection(input, on("field-notes"));
  const sportsAreas = on("sports-areas") ? buildSportsAreas(input) : null;
  const aiSummary: AiSummarySection | null =
    on("ai-summary") && input.aiSummaryText ? { summary: input.aiSummaryText } : null;
  const suggestions: SuggestionsSection | null =
    on("suggestions") && input.suggestionsText ? { text: input.suggestionsText } : null;

  const sections = sectionsFor(blocks, {
    scored: score !== null,
    mapAvailable: input.map !== null,
    sweepHasMarks: sweep !== null,
    hasSurveyorContent: surveyor !== null,
    hasSportsAreas: sportsAreas !== null,
    hasAiSummary: aiSummary !== null,
    hasSuggestions: suggestions !== null,
  });

  /* ------------------------------------------------------------- cover */

  const stats: ReportStat[] | null = on("stat-cards")
    ? [
        {
          label: "Google-listed facilities",
          value: atLeast(input.competitionCount, input.anySaturated),
          note: "Competing sports facilities inside the radius",
        },
        {
          label: "Their reviews",
          value: formatCount(input.reviewTotal),
          note: "Volume is evidence of paid play, not measured footfall",
        },
        {
          label: "Their average rating",
          value: formatRating(input.avgRating),
          note: "Across facilities Google carries a rating for",
        },
        {
          label: "Demand anchors",
          value: atLeast(input.demandCount, input.anySaturated),
          note: "Schools, colleges, workplaces, homes, transit",
          emphasis: true,
        },
      ]
    : null;

  const summaryParts = input.categories
    .filter((c) => c.count > 0)
    .map((c) => `${atLeast(c.count, c.saturated)} ${c.label.toLowerCase()}`);

  /* --------------------------------------------------------- catchment */

  const competition = buildCompetition(input);

  const observations = buildObservations({
    radiusM: input.radiusM,
    categories: input.categories.map((c) => ({
      categoryId: c.categoryId,
      label: c.label,
      side: c.side,
      count: c.count,
      saturated: c.saturated,
      reviewTotal: c.reviewTotal,
      nearestM: c.nearestM,
    })),
    places: input.places.map((p) => ({
      name: p.name,
      side: p.side,
      categories: p.categories,
      distanceM: p.distanceM,
      rating: p.rating,
      reviewCount: p.reviewCount,
      closesLate: p.closesLate,
      opensEarly: p.opensEarly,
    })),
    competitionCount: input.competitionCount,
    reviewTotal: input.reviewTotal,
    avgRating: input.avgRating,
    anySaturated: input.anySaturated,
    saturation: figures
      ? {
          anchorsPerFacility: figures.anchorsPerFacility,
          benchmarkAnchorsPerFacility: figures.benchmarkAnchorsPerFacility,
          benchmarkCity: figures.benchmarkCity,
          benchmarkSampleCount: figures.benchmarkSampleCount,
          standing,
        }
      : null,
    themes: competition.themes.map((t) => ({
      label: t.label,
      venueCount: t.venueCount,
      mentionCount: t.mentionCount,
    })),
    reviewedCompetitors: input.themes.reviewedCompetitors,
  });

  const limitationsBlock = populationLimitations();

  const document: ReportDocument = {
    meta: {
      scanId: input.scanId,
      reportId: input.reportId,
      version: input.version,
      title: `${input.areaLabel} — Site Scout report`,
      areaLabel: input.areaLabel,
      address: input.address,
      customerName: input.customerName,
      preparedBy: input.preparedBy,
      generatedAt: input.generatedAt,
      generatedAtLabel: formatFullDate(input.generatedAt),
      dataCollectedAtLabel: input.dataCollectedAt ? formatFullDate(input.dataCollectedAt) : null,
      radiusM: input.radiusM,
      radiusLabel: formatRadius(input.radiusM),
      areaKm2,
      centre: input.centre,
      scoreModelVersion: score?.modelVersion ?? null,
      checklistVersion: score?.checklistVersion ?? null,
      countsAreFloors: input.anySaturated,
    },
    sections,
    cover: {
      headline: `${input.areaLabel} — ${formatRadius(input.radiusM)} catchment`,
      verdictLabel: score ? verdictLabel(score.verdict) : null,
      verdictTone: score ? verdictTone(score.verdict) : null,
      scoreLine: score ? `${score.totalRounded} out of 100` : null,
      basisLabel: score?.basisLabel || null,
      stats,
      summarySentence:
        summaryParts.length > 0
          ? `Within ${formatRadius(input.radiusM)} of the site: ${summaryParts.join(" · ")}.`
          : `The scan of this ${formatRadius(input.radiusM)} catchment returned no Google-listed places in the categories searched.`,
    },
    verdict: score && on("score") ? buildVerdict(score) : null,
    catchment: {
      radiusLine: `A ${formatRadius(input.radiusM)} radius from ${input.centre.lat.toFixed(5)}, ${input.centre.lng.toFixed(5)}.`,
      areaLine: `${areaKm2.toFixed(2)} km² of ground, taken as a circle around the site pin.`,
      anchors: input.categories.filter((c) => c.side === "demand").map(anchorRow),
      saturation:
        on("saturation") && figures && figures.anchorsPerFacility !== null
          ? {
              figure: `One Google-listed facility per ${figures.anchorsPerFacility.toFixed(1)} weighted demand anchors`,
              benchmark:
                figures.benchmarkAnchorsPerFacility !== null
                  ? `${figures.benchmarkCity ?? "City"} median: one per ${figures.benchmarkAnchorsPerFacility.toFixed(1)}` +
                    (figures.benchmarkIsModelDefault
                      ? " — the scoring model's stated default, not a measurement"
                      : "")
                  : null,
              sampleLine:
                benchmarkSampleCaveat(figures.benchmarkSampleCount) ??
                `Derived from ${figures.benchmarkSampleCount} scans in this city.`,
              sampleCount: figures.benchmarkSampleCount,
              standing: standing ? `This catchment is ${standing} the city as a whole.` : null,
              methodNote: SATURATION_METHOD_NOTE,
              justification: figures.justification,
            }
          : null,
      observations,
      observationsNote: OBSERVATIONS_NOTE,
    },
    competition,
    demand: buildDemand(input, on("count-table")),
    sportsAreas,
    aiSummary,
    suggestions,
    map: on("map") ? input.map : null,
    sweep,
    observations: surveyor,
    limitations: {
      heading: limitationsBlock.heading,
      paragraphs: limitationsBlock.paragraphs.includes(POPULATION_LIMITATION_TEXT)
        ? limitationsBlock.paragraphs
        : [POPULATION_LIMITATION_TEXT, ...limitationsBlock.paragraphs],
      bullets: [...REPORT_LIMITATION_BULLETS],
    },
    footer: {
      legalName: brand.legalName,
      lines: [...brand.contactLines],
      disclaimer: brand.disclaimer,
      attribution: brand.attribution,
    },
  };

  return document;
}
