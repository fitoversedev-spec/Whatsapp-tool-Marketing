import { formatFullDate } from "@/lib/scout/display/format";
import { reportBrand } from "./brand";
import { REPORT_LIMITATION_BULLETS } from "./document";
import type {
  AnalysisOverviewSection,
  PlaceInsightEntry,
  PlaceInsightSection,
  ReportDocument,
  ReportMeta,
  ReportSectionId,
} from "./types";
import type { AreaSummaryResult, PlaceInsightResult } from "@/lib/scout/analysis/types";

export interface AnalysisDocumentInput {
  readonly scanId: string;
  readonly reportId: string | null;
  readonly version: number;
  readonly areaLabel: string;
  readonly address: string | null;
  readonly customerName: string | null;
  readonly preparedBy: string;
  readonly generatedAt: string;
  readonly radiusM: number;
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly areaSummary: AreaSummaryResult | null;
  readonly insights: ReadonlyArray<{
    readonly name: string;
    readonly insight: PlaceInsightResult;
    readonly pricingNote?: string | null;
  }>;
}

export function buildAnalysisDocument(input: AnalysisDocumentInput): ReportDocument {
  const brand = reportBrand();
  const generatedAt = new Date(input.generatedAt);

  const meta: ReportMeta = {
    scanId: input.scanId,
    reportId: input.reportId,
    version: input.version,
    title: `${input.areaLabel} — AI Analysis Report`,
    areaLabel: input.areaLabel,
    address: input.address,
    customerName: input.customerName,
    preparedBy: input.preparedBy,
    generatedAt: input.generatedAt,
    generatedAtLabel: formatFullDate(generatedAt),
    dataCollectedAtLabel: null,
    radiusM: input.radiusM,
    radiusLabel: `${(input.radiusM / 1000).toFixed(1)} km`,
    areaKm2: Math.PI * (input.radiusM / 1000) ** 2,
    centre: input.centre,
    scoreModelVersion: null,
    checklistVersion: null,
    countsAreFloors: false,
  };

  const analysisOverview: AnalysisOverviewSection | null = input.areaSummary
    ? {
        marketSaturation: {
          level: input.areaSummary.marketSaturation.level,
          explanation: input.areaSummary.marketSaturation.explanation,
        },
        opportunityScore: input.areaSummary.opportunityScore,
        risks: input.areaSummary.risks,
        executiveRecommendation: input.areaSummary.executiveRecommendation,
        competitorLearnings: input.areaSummary.competitorLearnings ?? [],
        opportunities: input.areaSummary.opportunities ?? [],
        promotionPlan: input.areaSummary.promotionPlan ?? [],
        launchChecklist: input.areaSummary.launchChecklist ?? [],
        oneLineStrategy: input.areaSummary.oneLineStrategy ?? null,
      }
    : null;

  const placeInsights: PlaceInsightSection | null =
    input.insights.length > 0
      ? {
          places: input.insights.map(({ name, insight, pricingNote }): PlaceInsightEntry => ({
            name,
            establishedDate: insight.establishedDate.value ?? "Not Available",
            popularTimes: insight.popularTimes.value ?? "Not Available",
            googleReviewsTone: insight.sentiment.googleReviews.tone,
            googleReviewsSummary: insight.sentiment.googleReviews.summary,
            socialMediaSummary: insight.sentiment.socialMedia.summary ?? "Not Available",
            whatWorks: insight.sentiment.whatWorks ?? [],
            whatDoesnt: insight.sentiment.whatDoesnt ?? [],
            suitability: insight.suitability.recommendation,
            suitabilityReasoning: insight.suitability.reasoning,
            confidence: insight.suitability.confidence,
            citations: insight.citations,
            pricingNote: pricingNote ?? null,
          })),
        }
      : null;

  const sections: ReportSectionId[] = ["cover"];
  if (analysisOverview) sections.push("analysisOverview");
  if (placeInsights) sections.push("placeInsights");
  sections.push("limitations");

  return {
    meta,
    sections,
    cover: {
      headline: `${input.areaLabel} — AI Analysis`,
      verdictLabel: analysisOverview
        ? `Opportunity: ${analysisOverview.opportunityScore.score}/10`
        : null,
      verdictTone: analysisOverview
        ? analysisOverview.opportunityScore.score >= 7
          ? "green"
          : analysisOverview.opportunityScore.score >= 4
            ? "blue"
            : "red"
        : null,
      scoreLine: null,
      basisLabel: "AI web search analysis",
      stats: [
        {
          label: "Places analysed",
          value: String(input.insights.length),
          note: "Competitor facilities analysed by AI",
        },
        {
          label: "Market saturation",
          value: analysisOverview?.marketSaturation.level ?? "N/A",
          note: "Overall market competitiveness",
        },
        {
          label: "Opportunity score",
          value: analysisOverview
            ? `${analysisOverview.opportunityScore.score}/10`
            : "N/A",
          note: "Higher is better for a new facility",
          emphasis: true,
        },
      ],
      summarySentence: analysisOverview
        ? analysisOverview.executiveRecommendation.split(".")[0] + "."
        : `AI analysis of ${input.insights.length} places in ${input.areaLabel}.`,
    },
    verdict: null,
    catchment: {
      radiusLine: `A ${(input.radiusM / 1000).toFixed(1)} km radius.`,
      areaLine: `${meta.areaKm2.toFixed(2)} km² of ground.`,
      anchors: [],
      saturation: null,
      observations: [],
      observationsNote: "",
    },
    competition: {
      headline: "",
      caveat: "",
      categories: [],
      themes: [],
      themeState: "",
    },
    demand: {
      headline: "",
      rows: [],
      countTable: null,
      distanceNote: "",
    },
    sportsAreas: null,
    aiSummary: null,
    suggestions: null,
    map: null,
    categoryMaps: [],
    sweep: null,
    observations: null,
    scanResults: null,
    analysisOverview,
    placeInsights,
    limitations: {
      heading: "AI analysis limitations",
      paragraphs: [
        "AI web search results are point-in-time and may not reflect the current state. Sources include Google, social media, and public business listings.",
      ],
      bullets: [
        "Establishment dates are approximate and based on publicly available information.",
        "Popular times data may not be available for all venues.",
        "Social media sentiment is based on publicly visible posts and may not reflect all customer opinions.",
        "Suitability recommendations are based on publicly available data and do not substitute for a professional site survey.",
        ...REPORT_LIMITATION_BULLETS,
      ],
    },
    footer: {
      legalName: brand.legalName,
      lines: [...brand.contactLines],
      disclaimer: brand.disclaimer,
      attribution: brand.attribution,
    },
  };
}
