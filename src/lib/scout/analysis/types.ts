export type Confidence = "High" | "Medium" | "Low";

export interface InsightField {
  value: string | null;
  confidence: Confidence;
  source: string | null;
}

export interface SentimentDetail {
  summary: string;
  tone: "Positive" | "Mixed" | "Negative" | "Insufficient data";
  confidence: Confidence;
}

export interface SocialMediaDetail {
  summary: string | null;
  confidence: Confidence;
  source: string | null;
}

export interface SuitabilityDetail {
  recommendation: string;
  confidence: Confidence;
  reasoning: string;
}

export interface Citation {
  url: string;
  title: string;
}

export interface PlaceInsightResult {
  establishedDate: InsightField;
  popularTimes: InsightField;
  sentiment: {
    googleReviews: SentimentDetail;
    socialMedia: SocialMediaDetail;
    whatWorks: string[];
    whatDoesnt: string[];
  };
  suitability: SuitabilityDetail;
  citations: Citation[];
}

export interface CompetitorLearning {
  complaint: string;
  seenAt: string;
  ourRule: string;
}

export interface Opportunity {
  title: string;
  detail: string;
}

export interface PromotionAction {
  channel: string;
  action: string;
  timeline: string;
}

export interface ChecklistItem {
  task: string;
  priority: "High" | "Medium" | "Low";
  when: string;
}

export interface AreaSummaryResult {
  marketSaturation: {
    level: "Low" | "Moderate" | "High" | "Oversaturated";
    explanation: string;
  };
  opportunityScore: { score: number; reasoning: string };
  risks: string[];
  executiveRecommendation: string;
  competitorLearnings: CompetitorLearning[];
  opportunities: Opportunity[];
  promotionPlan: PromotionAction[];
  launchChecklist: ChecklistItem[];
  oneLineStrategy: string;
}

export interface PlaceContext {
  placeInternalId: string;
  googlePlaceId: string;
  name: string;
  address: string | null;
  googleMapsUri: string | null;
  rating: number | null;
  reviewCount: number | null;
  primaryType: string | null;
  primaryTypeDisplayName: string | null;
  priceLevel: number | null;
  websiteUri: string | null;
  phone: string | null;
  googleTypes: string[];
  businessStatus: string | null;
  operatingWindow: Record<string, unknown> | null;
  reviewThemes: ReadonlyArray<{
    theme: string;
    sentiment: string;
    mentionCount: number;
  }>;
}

export type DataQuality = "good" | "limited" | "search_limited";

export interface AnalysisPlaceResult {
  placeInternalId: string;
  googlePlaceId: string;
  insight: PlaceInsightResult;
  inputTokens: number;
  outputTokens: number;
  dataQuality: DataQuality;
}

export interface CostEstimate {
  placeCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  estimatedCostInr: number;
}
