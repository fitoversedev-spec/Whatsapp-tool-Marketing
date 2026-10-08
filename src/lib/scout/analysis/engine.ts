import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { AI_LOOP_TOTAL_MS, AI_MODEL, getAnthropic } from "@/lib/ai/client";
import { deadline } from "@/lib/http";
import { mapAnthropicError } from "@/lib/ai/errors";
import { logAiUsage } from "@/lib/ai/guardrails";
import { generateStructured } from "@/lib/ai/structured";
import {
  SEARCH_SYSTEM_PROMPT,
  buildSearchPrompt,
  EXTRACTION_SYSTEM,
  EXTRACTION_SCHEMA,
} from "./prompts";
import type { PlaceContext, PlaceInsightResult, AnalysisPlaceResult, DataQuality } from "./types";

const MAX_SEARCH_ROUNDS = 10;

export async function analysePlace(
  userId: string,
  place: PlaceContext,
): Promise<AnalysisPlaceResult> {
  const client = getAnthropic();
  let totalInput = 0;
  let totalOutput = 0;

  // Step 1: Web search to gather raw data
  const searchContent = await runWebSearch(client, place);
  totalInput += searchContent.inputTokens;
  totalOutput += searchContent.outputTokens;

  await logAiUsage({
    userId,
    feature: "scout-analysis-place-search",
    inputTokens: searchContent.inputTokens,
    outputTokens: searchContent.outputTokens,
  });

  // Step 2: Structured extraction from search results
  const extractionParts = [
    `Here are the web search results for "${place.name}":`,
    "",
    searchContent.text,
    "",
  ];
  if (searchContent.searchLimited) {
    extractionParts.push(
      "WARNING: The web search hit the maximum number of rounds and may be incomplete. Mark any fields that rely solely on incomplete search data as Low confidence.",
      "",
    );
  }
  extractionParts.push(
    "Extract structured insights from these search results. For anything not found in the results, use null and Low confidence.",
  );

  const { result: insight, inputTokens: extInput, outputTokens: extOutput } =
    await generateStructured<PlaceInsightResult>({
      feature: "scout-analysis-place-extract",
      userId,
      system: EXTRACTION_SYSTEM,
      user: extractionParts.join("\n"),
      schema: EXTRACTION_SCHEMA,
      maxTokens: 2000,
    });

  totalInput += extInput;
  totalOutput += extOutput;

  const dataQuality = assessDataQuality(insight, searchContent.searchLimited);

  return {
    placeInternalId: place.placeInternalId,
    googlePlaceId: place.googlePlaceId,
    insight,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    dataQuality,
  };
}

function assessDataQuality(insight: PlaceInsightResult, searchLimited: boolean): DataQuality {
  if (searchLimited) return "search_limited";

  const isEmpty =
    insight.establishedDate.value === null &&
    insight.popularTimes.value === null &&
    insight.sentiment.googleReviews.tone === "Insufficient data" &&
    (!insight.sentiment.whatWorks || insight.sentiment.whatWorks.length === 0) &&
    (!insight.sentiment.whatDoesnt || insight.sentiment.whatDoesnt.length === 0);

  return isEmpty ? "limited" : "good";
}

async function runWebSearch(
  client: Anthropic,
  place: PlaceContext,
): Promise<{ text: string; inputTokens: number; outputTokens: number; searchLimited: boolean }> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildSearchPrompt(place) },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  const accumulatedText: string[] = [];
  // Overall time budget so the whole search stays inside the function cap.
  const clock = deadline(AI_LOOP_TOTAL_MS);

  try {
    let response: Anthropic.Message;
    let rounds = 0;

    while (rounds < MAX_SEARCH_ROUNDS) {
      // Not enough time for another round: stop here and return what we have
      // (flagged as limited, same as running out of rounds).
      if (rounds > 0 && clock.remaining() < 12_000) break;
      rounds++;
      response = await client.messages.create(
        {
          model: AI_MODEL,
          max_tokens: 4000,
          thinking: { type: "disabled" },
          system: SEARCH_SYSTEM_PROMPT,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
          messages,
        },
        {
          timeout: Math.max(2_000, Math.min(30_000, clock.remaining() - 3_000)),
          maxRetries: 0,
        },
      );

      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;

      if (response.stop_reason === "pause_turn") {
        for (const b of response.content) {
          if (b.type === "text" && b.text) accumulatedText.push(b.text);
        }
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      const textParts = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text);

      return {
        text: textParts.join("\n\n") || "No search results found.",
        inputTokens: totalInput,
        outputTokens: totalOutput,
        searchLimited: false,
      };
    }

    console.warn(
      JSON.stringify({ event: "scout_search_max_rounds", place: place.name, rounds }),
    );

    return {
      text: accumulatedText.join("\n\n") || "No search results found after maximum search rounds.",
      inputTokens: totalInput,
      outputTokens: totalOutput,
      searchLimited: true,
    };
  } catch (e) {
    const mapped = mapAnthropicError(e);
    // A slow later round shouldn't throw away what earlier rounds found.
    if (mapped.code === "timeout" && accumulatedText.length > 0) {
      return {
        text: accumulatedText.join("\n\n"),
        inputTokens: totalInput,
        outputTokens: totalOutput,
        searchLimited: true,
      };
    }
    throw mapped;
  }
}
