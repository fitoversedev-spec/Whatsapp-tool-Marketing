/**
 * The report document — the fully resolved, render-ready shape of a Site Scout
 * PDF.
 *
 * Nothing in here is derived at render time. `buildReportDocument` resolves
 * every number, every caveat and every sentence, and the renderer only decides
 * where they sit on the page. That split is what makes the golden-file tests
 * worth having: a change in wording or in arithmetic shows up in the document
 * diff, not buried inside a JSX tree.
 *
 * ## Two rules the shape itself enforces
 *
 * 1. `verdict` carries `components` as a required array. There is no way to
 *    construct a verdict section holding a total and no breakdown — the same
 *    decision `ScorePanel` made on screen, made again in the type.
 * 2. Counts arrive as **display strings** that already carry the "at least"
 *    qualifier. A renderer that formatted its own counts would eventually
 *    print one of them unqualified.
 */

export type ReportSectionId =
  | "cover"
  | "verdict"
  | "catchment"
  | "competition"
  | "demand"
  | "sportsAreas"
  | "aiSummary"
  | "suggestions"
  | "map"
  | "sweep"
  | "observations"
  | "limitations";

/** Section titles, in document order. Numbering on the page comes from here. */
export const REPORT_SECTION_TITLES: Readonly<Record<ReportSectionId, string>> = {
  cover: "Site Scout report",
  verdict: "The verdict",
  catchment: "The catchment",
  competition: "Competition",
  demand: "Demand anchors",
  sportsAreas: "Available sports facilities",
  aiSummary: "AI analysis",
  suggestions: "Our suggestions",
  map: "The catchment, mapped",
  sweep: "Marked open spaces",
  observations: "Surveyor observations",
  limitations: "What this report does not cover",
};

/* ------------------------------------------------------------------ meta */

export interface ReportMeta {
  readonly scanId: string;
  readonly reportId: string | null;
  /** Regeneration produces a new version; old ones stay retrievable. */
  readonly version: number;
  readonly title: string;
  readonly areaLabel: string;
  readonly address: string | null;
  readonly customerName: string | null;
  readonly preparedBy: string;
  /** ISO. Fixed by the caller so a golden test is not a function of the clock. */
  readonly generatedAt: string;
  readonly generatedAtLabel: string;
  readonly dataCollectedAtLabel: string | null;
  readonly radiusM: number;
  readonly radiusLabel: string;
  readonly areaKm2: number;
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly scoreModelVersion: string | null;
  readonly checklistVersion: string | null;
  /** True when any search truncated, so every count on the page is a floor. */
  readonly countsAreFloors: boolean;
}

/* ----------------------------------------------------------------- cover */

export interface ReportStat {
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
  readonly emphasis?: boolean;
}

export interface CoverSection {
  readonly headline: string;
  readonly verdictLabel: string | null;
  readonly verdictTone: "green" | "blue" | "red" | null;
  readonly scoreLine: string | null;
  readonly basisLabel: string | null;
  /** Null when the `stat-cards` block is off. */
  readonly stats: readonly ReportStat[] | null;
  readonly summarySentence: string;
}

/* --------------------------------------------------------------- verdict */

export interface VerdictComponent {
  readonly id: string;
  readonly label: string;
  /** "11.4 / 20", or "Excluded" where the component was not scored. */
  readonly points: string;
  /** 0–1, for the bar. `null` where the component was excluded. */
  readonly fraction: number | null;
  readonly included: boolean;
  readonly justification: string;
  readonly parts: ReadonlyArray<{ readonly label: string; readonly detail: string }>;
}

export interface VerdictSection {
  readonly total: string;
  readonly outOf: string;
  readonly verdictLabel: string;
  readonly verdictTone: "green" | "blue" | "red";
  readonly statement: string;
  readonly basisLabel: string | null;
  readonly confidenceLabel: string;
  readonly confidenceReasons: readonly string[];
  readonly modelVersionLine: string;
  /** Never empty. A score without its breakdown is not a section this type can hold. */
  readonly components: readonly VerdictComponent[];
  readonly hardFlags: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  readonly otherFlags: ReadonlyArray<{ readonly code: string; readonly message: string }>;
}

/* -------------------------------------------------------------- catchment */

export interface CatchmentAnchorRow {
  readonly label: string;
  readonly count: string;
  readonly nearestName: string | null;
  readonly nearestDistance: string;
}

export interface SaturationBlock {
  readonly figure: string;
  readonly benchmark: string | null;
  readonly sampleLine: string;
  readonly sampleCount: number;
  readonly standing: string | null;
  readonly methodNote: string;
  readonly justification: string;
}

export interface CatchmentSection {
  readonly radiusLine: string;
  readonly areaLine: string;
  readonly anchors: readonly CatchmentAnchorRow[];
  /** Null when the `saturation` block is off, or the scan is unscored. */
  readonly saturation: SaturationBlock | null;
  /**
   * v16's computed observations, each citing its own numbers.
   *
   * They live in the catchment section rather than under the surveyor's
   * heading because they are read *from the data*, not seen on the ground, and
   * the document must never blur the two. Unconditional, for the same reason
   * v16 printed them: they are the part a salesperson can argue from.
   */
  readonly observations: readonly string[];
  readonly observationsNote: string;
}

/* ------------------------------------------------------------ competition */

export interface CompetitorRow {
  readonly name: string;
  readonly rating: string;
  readonly reviews: string;
  readonly distance: string;
  readonly window: string;
  readonly priceTier: string;
}

export interface CompetitorCategory {
  readonly categoryId: string;
  readonly label: string;
  readonly countLine: string;
  readonly rows: readonly CompetitorRow[];
  readonly overflow: number;
}

export interface ComplaintTheme {
  readonly theme: string;
  readonly label: string;
  readonly venueCount: number;
  readonly mentionCount: number;
  readonly summary: string;
  readonly quotes: ReadonlyArray<{ readonly venue: string; readonly quote: string }>;
}

export interface CompetitionSection {
  readonly headline: string;
  readonly caveat: string;
  readonly categories: readonly CompetitorCategory[];
  readonly themes: readonly ComplaintTheme[];
  /** Says which of "analysed and found nothing" / "not analysed" happened. */
  readonly themeState: string;
}

/* ---------------------------------------------------------------- demand */

export interface DemandSection {
  readonly headline: string;
  readonly rows: readonly CatchmentAnchorRow[];
  /** Null when the `count-table` block is off. */
  readonly countTable: readonly CountTableRow[] | null;
  readonly distanceNote: string;
}

export interface CountTableRow {
  readonly label: string;
  readonly side: string;
  readonly count: string;
  readonly reviews: string;
  readonly nearest: string;
}

/* ---------------------------------------------------------- sportsAreas */

export interface SportsAreaRow {
  readonly name: string;
  readonly category: string;
  readonly distance: string;
  readonly rating: string;
  readonly reviews: string;
}

export interface SportsAreasSection {
  readonly headline: string;
  readonly rows: readonly SportsAreaRow[];
}

/* -------------------------------------------------------------- aiSummary */

export interface AiSummarySection {
  readonly summary: string;
}

/* ----------------------------------------------------------- suggestions */

export interface SuggestionsSection {
  readonly text: string;
}

/* ------------------------------------------------------------------- map */

export interface MapSection {
  readonly url: string;
  readonly alt: string;
  readonly attribution: string;
  readonly legend: readonly string[];
}

/* ----------------------------------------------------------------- sweep */

export interface SweepSection {
  readonly summary: string;
  readonly rows: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly note: string;
    readonly coordinates: string;
  }>;
  readonly caveat: string;
}

/* ---------------------------------------------------------- observations */

export interface ObservationsSection {
  /** Checklist ratings, grouped as the client defined them. */
  readonly groups: ReadonlyArray<{
    readonly label: string;
    readonly fields: ReadonlyArray<{
      readonly label: string;
      readonly rating: string;
      readonly anchor: string;
    }>;
  }>;
  readonly answeredLine: string;
  readonly fieldNotes: string | null;
  readonly hardFlagNote: string | null;
}

/* ----------------------------------------------------------- limitations */

export interface LimitationsSection {
  readonly heading: string;
  /** Phase 2's exported paragraphs, verbatim and first. */
  readonly paragraphs: readonly string[];
  readonly bullets: readonly string[];
}

/* -------------------------------------------------------------- document */

export interface ReportFooter {
  readonly legalName: string;
  readonly lines: readonly string[];
  readonly disclaimer: string;
  readonly attribution: string;
}

export interface ReportDocument {
  readonly meta: ReportMeta;
  /** Which sections this document prints, in order. */
  readonly sections: readonly ReportSectionId[];
  readonly cover: CoverSection;
  readonly verdict: VerdictSection | null;
  readonly catchment: CatchmentSection;
  readonly competition: CompetitionSection;
  readonly demand: DemandSection;
  readonly sportsAreas: SportsAreasSection | null;
  readonly aiSummary: AiSummarySection | null;
  readonly suggestions: SuggestionsSection | null;
  readonly map: MapSection | null;
  readonly sweep: SweepSection | null;
  readonly observations: ObservationsSection | null;
  readonly limitations: LimitationsSection;
  readonly footer: ReportFooter;
}
