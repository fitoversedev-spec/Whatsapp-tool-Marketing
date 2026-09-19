import "server-only";

import { generateStructured } from "@/lib/ai/structured";
import {
  AREA_SUMMARY_SYSTEM,
  AREA_SUMMARY_SCHEMA,
  buildAreaSummaryPrompt,
} from "./prompts";
import type { AreaSummaryResult, PlaceInsightResult } from "./types";

export async function generateAreaSummary(
  userId: string,
  areaLabel: string,
  radiusM: number,
  insights: ReadonlyArray<{ name: string; insight: PlaceInsightResult }>,
): Promise<AreaSummaryResult> {
  return generateStructured<AreaSummaryResult>({
    feature: "scout-analysis-summary",
    userId,
    system: AREA_SUMMARY_SYSTEM,
    user: buildAreaSummaryPrompt(areaLabel, radiusM, insights),
    schema: AREA_SUMMARY_SCHEMA,
    cacheSystem: true,
    maxTokens: 4000,
  });
}
