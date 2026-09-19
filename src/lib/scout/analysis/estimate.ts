import type { CostEstimate } from "./types";

const TOKENS_PER_PLACE_INPUT = 2000;
const TOKENS_PER_PLACE_OUTPUT = 3000;
const SUMMARY_INPUT = 1500;
const SUMMARY_OUTPUT = 1000;

const SONNET_INPUT_PER_MTOK_USD = 2;
const SONNET_OUTPUT_PER_MTOK_USD = 10;
const USD_TO_INR = 84;

export function estimateAnalysisCost(placeCount: number): CostEstimate {
  const inputTokens = placeCount * TOKENS_PER_PLACE_INPUT + SUMMARY_INPUT;
  const outputTokens = placeCount * TOKENS_PER_PLACE_OUTPUT + SUMMARY_OUTPUT;

  const costUsd =
    (inputTokens / 1_000_000) * SONNET_INPUT_PER_MTOK_USD +
    (outputTokens / 1_000_000) * SONNET_OUTPUT_PER_MTOK_USD;

  return {
    placeCount,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCostUsd: Math.round(costUsd * 100) / 100,
    estimatedCostInr: Math.round(costUsd * USD_TO_INR * 100) / 100,
  };
}
