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
} from "./repository";
import { estimateAnalysisCost } from "./estimate";
import { assertWithinAnalysisCap } from "./guardrails";
import type { PlaceContext, PlaceInsightResult } from "./types";

const BATCH_SIZE = 1;
const CONCURRENCY = 1;
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

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
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
  const finalStatus = completedInsights.length === 0 ? "failed" : (
    completedInsights.length < places.length ? "partial" : "completed"
  );

  let areaSummary = undefined;
  if (completedInsights.length > 0) {
    try {
      // We need scan info for the summary — fetch from the analysis
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
      );
    } catch (e) {
      console.warn(
        JSON.stringify({
          event: "scout_analysis_summary_failed",
          analysisId,
          error: e instanceof Error ? e.message : "unknown",
        }),
      );
    }
  }

  await updateAnalysisStatus(analysisId, finalStatus, {
    areaSummary: areaSummary as unknown as Prisma.InputJsonValue | undefined,
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
        await sleep(1000 * attempt);
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
