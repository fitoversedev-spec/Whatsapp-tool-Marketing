import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, getAnthropic } from "@/lib/ai/client";
import { mapAnthropicError } from "@/lib/ai/errors";
import { logAiUsage } from "@/lib/ai/guardrails";
import { generateStructured } from "@/lib/ai/structured";
import {
  SEARCH_SYSTEM_PROMPT,
  buildSearchPrompt,
  EXTRACTION_SYSTEM,
  EXTRACTION_SCHEMA,
} from "./prompts";
import type { PlaceContext, PlaceInsightResult, AnalysisPlaceResult } from "./types";

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
  const extractionPrompt = [
    `Here are the web search results for "${place.name}":`,
    "",
    searchContent.text,
    "",
    "Extract structured insights from these search results. For anything not found in the results, use null and Low confidence.",
  ].join("\n");

  const insight = await generateStructured<PlaceInsightResult>({
    feature: "scout-analysis-place-extract",
    userId,
    system: EXTRACTION_SYSTEM,
    user: extractionPrompt,
    schema: EXTRACTION_SCHEMA,
    maxTokens: 2000,
  });

  // generateStructured already logs usage internally, but we need the token
  // counts for progress tracking. Estimate extraction at ~500 in + ~1500 out.
  totalInput += 500;
  totalOutput += 1500;

  return {
    placeInternalId: place.placeInternalId,
    googlePlaceId: place.googlePlaceId,
    insight,
    inputTokens: totalInput,
    outputTokens: totalOutput,
  };
}

async function runWebSearch(
  client: Anthropic,
  place: PlaceContext,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildSearchPrompt(place) },
  ];

  let totalInput = 0;
  let totalOutput = 0;

  try {
    let response: Anthropic.Message;
    let rounds = 0;

    while (rounds < MAX_SEARCH_ROUNDS) {
      rounds++;
      response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 4000,
        thinking: { type: "disabled" },
        system: SEARCH_SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      });

      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;

      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      // end_turn or tool_use that isn't pause — extract text
      const textParts = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text);

      return {
        text: textParts.join("\n\n") || "No search results found.",
        inputTokens: totalInput,
        outputTokens: totalOutput,
      };
    }

    return {
      text: "Search exceeded maximum rounds.",
      inputTokens: totalInput,
      outputTokens: totalOutput,
    };
  } catch (e) {
    throw mapAnthropicError(e);
  }
}
