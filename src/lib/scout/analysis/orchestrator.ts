import "server-only";

import type { Prisma } from "@prisma/client";
import { AiError } from "@/lib/ai/errors";
import { analysePlace } from "./engine";
import { generateAreaSummary } from "./summary";
import {
  createAnalysis,
  createInsightRows,
  getAnalysisPlaces,
  incrementAnalysisProgress,
  markInsightFailed,
  saveInsightResult,
  updateAnalysisStatus,
  getCachedInsight,
  cacheInsight,
} from "./repository";
import { estimateAnalysisCost } from "./estimate";
import { assertWithinAnalysisCap } from "./guardrails";
import type { PlaceContext, PlaceInsightResult } from "./types";

const BATCH_SIZE = 2;
const CONCURRENCY = 2;
const MAX_RETRIES = 3;

export async function startAnalysis(scanId: string, userId: string) {
  await assertWithinAnalysisCap(userId);

  const places = await getAnalysisPlaces(scanId);
  if (places.length === 0) {
    throw new AiError("No places to analyse — all competition places may be excluded.", "failed");
  }

  const estimate = estimateAnalysisCost(places.length);
  const analysis = await createAnalysis(scanId, userId, places.length);

  await updateAnalysisStatus(analysis.id, "pending", {
    costEstimate: estimate as unknown as Prisma.InputJsonValue,
  });

  await createInsightRows(
    analysis.id,
    places.map((p) => ({ placeId: p.placeInternalId, googlePlaceId: p.googlePlaceId })),
  );

  return { analysisId: analysis.id, places, estimate };
}

export async function runAnalysis(
  analysisId: string,
  userId: string,
  places: PlaceContext[],
) {
  await updateAnalysisStatus(analysisId, "running", { startedAt: new Date() });

  const completedInsights: Array<{ name: string; insight: PlaceInsightResult }> = [];
  const uncachedPlaces: PlaceContext[] = [];

  for (const place of places) {
    const cached = await getCachedInsight(place.googlePlaceId);
    if (cached) {
      await saveInsightResult(
        analysisId,
        place.placeInternalId,
        cached.insight,
        0,
        0,
      );
      completedInsights.push({ name: place.name, insight: cached.insight });
      await incrementAnalysisProgress(analysisId, 1, 0, 0, 0);
    } else {
      uncachedPlaces.push(place);
    }
  }

  for (let i = 0; i < uncachedPlaces.length; i += BATCH_SIZE) {
    const batch = uncachedPlaces.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((place) => analysePlaceWithRetry(userId, place)),
    );

    let batchCompleted = 0;
    let batchFailed = 0;
    let batchInput = 0;
    let batchOutput = 0;

    for (const [idx, settled] of results.entries()) {
      const place = batch[idx]!;

      if (settled.status === "fulfilled") {
        const result = settled.value;
        await saveInsightResult(
          analysisId,
          result.placeInternalId,
          result.insight,
          result.inputTokens,
          result.outputTokens,
        );
        completedInsights.push({ name: place.name, insight: result.insight });
        batchCompleted++;
        batchInput += result.inputTokens;
        batchOutput += result.outputTokens;

        await cacheInsight(
          result.googlePlaceId,
          place.name,
          result.insight,
          { input: result.inputTokens, output: result.outputTokens },
          result.dataQuality,
        ).catch(() => {});
      } else {
        const errorMsg =
          settled.reason instanceof Error ? settled.reason.message : "Unknown error";
        await markInsightFailed(analysisId, place.placeInternalId, errorMsg);
        batchFailed++;
        console.warn(
          JSON.stringify({
            event: "scout_analysis_place_failed",
            analysisId,
            placeId: place.googlePlaceId,
            error: errorMsg,
          }),
        );
      }
    }

    await incrementAnalysisProgress(
      analysisId,
      batchCompleted,
      batchFailed,
      batchInput,
      batchOutput,
    );
  }

  // Generate area summary from completed insights
  let insightsStatus: "failed" | "partial" | "completed" =
    completedInsights.length === 0 ? "failed" : (
      completedInsights.length < places.length ? "partial" : "completed"
    );

  let areaSummary: Prisma.InputJsonValue | undefined = undefined;
  let summaryFailed = false;
  if (completedInsights.length > 0) {
    try {
      const { prisma } = await import("@/lib/prisma");
      const analysis = await prisma.scoutAnalysis.findUniqueOrThrow({
        where: { id: analysisId },
        include: { scan: { select: { areaLabel: true, radiusM: true } } },
      });

      areaSummary = await generateAreaSummary(
        userId,
        analysis.scan.areaLabel,
        analysis.scan.radiusM,
        completedInsights,
      ) as unknown as Prisma.InputJsonValue;
    } catch (e) {
      summaryFailed = true;
      const errorMsg = e instanceof Error ? e.message : "unknown";
      console.error(
        JSON.stringify({
          event: "scout_analysis_summary_failed",
          analysisId,
          error: errorMsg,
        }),
      );
      areaSummary = { error: true, message: `Area summary generation failed: ${errorMsg}` } as unknown as Prisma.InputJsonValue;
    }
  }

  const finalStatus = insightsStatus === "failed" ? "failed" : (
    summaryFailed || insightsStatus === "partial" ? "partial" : "completed"
  );

  await updateAnalysisStatus(analysisId, finalStatus, {
    areaSummary,
    finishedAt: new Date(),
    ...(finalStatus === "failed" && completedInsights.length === 0
      ? { error: "All place analyses failed" }
      : {}),
  });

  return { status: finalStatus, completedCount: completedInsights.length };
}

async function analysePlaceWithRetry(userId: string, place: PlaceContext) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await analysePlace(userId, place);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error("Unknown error");
      if (e instanceof AiError && (e.code === "limit" || e.code === "no_credit")) {
        throw e;
      }
      if (attempt < MAX_RETRIES) {
        const isRateLimit = e instanceof AiError && e.code === "rate_limit";
        await sleep(isRateLimit ? 30_000 * attempt : 2000 * attempt);
      }
    }
  }

  throw lastError ?? new Error("Analysis failed after retries");
}

export async function analyseSinglePlace(
  analysisId: string,
  userId: string,
  place: PlaceContext,
) {
  await assertWithinAnalysisCap(userId);

  try {
    const result = await analysePlaceWithRetry(userId, place);
    await saveInsightResult(
      analysisId,
      result.placeInternalId,
      result.insight,
      result.inputTokens,
      result.outputTokens,
    );
    await incrementAnalysisProgress(analysisId, 1, 0, result.inputTokens, result.outputTokens);

    await cacheInsight(
      result.googlePlaceId,
      place.name,
      result.insight,
      { input: result.inputTokens, output: result.outputTokens },
      result.dataQuality,
    ).catch(() => {});

    return result;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    await markInsightFailed(analysisId, place.placeInternalId, errorMsg);
    await incrementAnalysisProgress(analysisId, 0, 1, 0, 0);
    throw e;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
