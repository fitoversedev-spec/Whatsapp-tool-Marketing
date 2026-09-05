import { generateStructured } from "@/lib/ai/structured";
import { aiConfigured } from "@/lib/ai/client";

interface AiSummaryInput {
  readonly areaLabel: string;
  readonly radiusM: number;
  readonly competitionCount: number;
  readonly demandCount: number;
  readonly avgRating: number | null;
  readonly reviewTotal: number;
  readonly categories: ReadonlyArray<{
    readonly label: string;
    readonly side: "competition" | "demand";
    readonly count: number;
    readonly reviewTotal: number;
    readonly avgRating: number | null;
  }>;
  readonly places: ReadonlyArray<{
    readonly name: string;
    readonly side: "competition" | "demand";
    readonly rating: number | null;
    readonly reviewCount: number | null;
    readonly distanceM: number;
  }>;
  readonly scoreTotal: number | null;
  readonly scoreVerdict: string | null;
}

interface AiSummaryResult {
  readonly summary: string;
}

const SYSTEM = `You are an expert sports facility consultant for Fitoverse, analysing site scout data for potential sports facility locations in India. You write in clear, professional English. Your analysis is data-driven and actionable.

Given scan data for a location, produce a concise analysis covering:
1. Which sports are most viable for this area based on existing competition and demand
2. Revenue potential — consider demand anchors (schools, colleges, offices nearby) and competition density
3. Competitive landscape — gaps and opportunities
4. Area suitability — what makes this location promising or challenging

Keep it under 300 words. Be specific about the data. Do not make up numbers — only reference what is in the scan data provided.`;

export function canGenerateAiSummary(): boolean {
  return aiConfigured();
}

export async function generateAiSummary(
  userId: string,
  input: AiSummaryInput,
): Promise<string> {
  const competitionPlaces = input.places.filter((p) => p.side === "competition");
  const competitionCategories = input.categories.filter((c) => c.side === "competition");
  const demandCategories = input.categories.filter((c) => c.side === "demand");

  const prompt = [
    `Analyse this site scout data for ${input.areaLabel} (${(input.radiusM / 1000).toFixed(1)} km radius):`,
    "",
    `Competition: ${input.competitionCount} facilities, ${input.reviewTotal} total reviews, avg rating ${input.avgRating?.toFixed(1) ?? "N/A"}`,
    `Demand anchors: ${input.demandCount} (schools, offices, homes, transit nearby)`,
    input.scoreTotal !== null ? `Site score: ${input.scoreTotal}/100 (${input.scoreVerdict ?? "unclassified"})` : "",
    "",
    "Competition categories:",
    ...competitionCategories.map((c) => `  - ${c.label}: ${c.count} found, ${c.reviewTotal} reviews, avg ${c.avgRating?.toFixed(1) ?? "N/A"}`),
    "",
    "Demand categories:",
    ...demandCategories.map((c) => `  - ${c.label}: ${c.count} found`),
    "",
    `Top facilities (by distance):`,
    ...competitionPlaces
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 10)
      .map((p) => `  - ${p.name}: ${(p.distanceM / 1000).toFixed(1)} km away, rating ${p.rating?.toFixed(1) ?? "N/A"}, ${p.reviewCount ?? 0} reviews`),
  ].filter(Boolean).join("\n");

  const result = await generateStructured<AiSummaryResult>({
    feature: "scout-ai-summary",
    userId,
    system: SYSTEM,
    user: prompt,
    schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "The complete AI analysis text, ready to include in the report PDF.",
        },
      },
      required: ["summary"],
    },
    maxTokens: 1500,
  });

  return result.summary;
}
