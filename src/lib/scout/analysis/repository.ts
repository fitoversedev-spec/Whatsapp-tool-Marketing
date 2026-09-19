import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AnalysisStatus } from "@prisma/client";
import type { PlaceInsightResult, PlaceContext } from "./types";

export async function createAnalysis(scanId: string, ownerId: string, totalPlaces: number) {
  return prisma.scoutAnalysis.create({
    data: { scanId, ownerId, totalPlaces },
  });
}

export async function getAnalysis(id: string) {
  return prisma.scoutAnalysis.findUnique({
    where: { id },
    include: { insights: true },
  });
}

export async function getAnalysisByScanAndOwner(scanId: string, ownerId: string) {
  return prisma.scoutAnalysis.findUnique({
    where: { scanId_ownerId: { scanId, ownerId } },
    include: {
      insights: {
        include: { place: { select: { name: true } } },
      },
    },
  });
}

export async function getOriginalAnalysisForScan(scanId: string) {
  return prisma.scoutAnalysis.findFirst({
    where: { scanId, sourceAnalysisId: null, status: { in: ["completed", "partial"] } },
    include: { insights: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateAnalysisStatus(
  id: string,
  status: AnalysisStatus,
  extra?: {
    completedPlaces?: number;
    failedPlaces?: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
    areaSummary?: Prisma.InputJsonValue;
    costEstimate?: Prisma.InputJsonValue;
    startedAt?: Date;
    finishedAt?: Date;
  },
) {
  return prisma.scoutAnalysis.update({
    where: { id },
    data: {
      status,
      ...extra,
      updatedAt: new Date(),
    },
  });
}

export async function incrementAnalysisProgress(
  id: string,
  completed: number,
  failed: number,
  inputTokens: number,
  outputTokens: number,
) {
  return prisma.scoutAnalysis.update({
    where: { id },
    data: {
      completedPlaces: { increment: completed },
      failedPlaces: { increment: failed },
      inputTokens: { increment: inputTokens },
      outputTokens: { increment: outputTokens },
      updatedAt: new Date(),
    },
  });
}

export async function createInsightRows(
  analysisId: string,
  places: ReadonlyArray<{ placeId: string; googlePlaceId: string }>,
) {
  return prisma.scoutPlaceInsight.createMany({
    data: places.map((p) => ({
      analysisId,
      placeId: p.placeId,
      googlePlaceId: p.googlePlaceId,
    })),
  });
}

export async function saveInsightResult(
  analysisId: string,
  placeId: string,
  insight: PlaceInsightResult,
  inputTokens: number,
  outputTokens: number,
) {
  return prisma.scoutPlaceInsight.update({
    where: { analysisId_placeId: { analysisId, placeId } },
    data: {
      status: "completed",
      establishedDate: insight.establishedDate as unknown as Prisma.InputJsonValue,
      popularTimes: insight.popularTimes as unknown as Prisma.InputJsonValue,
      sentiment: insight.sentiment as unknown as Prisma.InputJsonValue,
      suitability: insight.suitability as unknown as Prisma.InputJsonValue,
      rawSources: insight.citations as unknown as Prisma.InputJsonValue,
      inputTokens,
      outputTokens,
      analysedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function markInsightFailed(
  analysisId: string,
  placeId: string,
  error: string,
) {
  return prisma.scoutPlaceInsight.update({
    where: { analysisId_placeId: { analysisId, placeId } },
    data: {
      status: "failed",
      retryCount: { increment: 1 },
      error,
      updatedAt: new Date(),
    },
  });
}

export async function saveInsightEdits(
  insightId: string,
  editedFields: Record<string, unknown>,
) {
  return prisma.scoutPlaceInsight.update({
    where: { id: insightId },
    data: { editedFields: editedFields as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
  });
}

export async function getAnalysisPlaces(scanId: string): Promise<PlaceContext[]> {
  const scanPlaces = await prisma.scanPlace.findMany({
    where: {
      scanId,
      side: "competition",
      scan: {
        excludedPlaces: { none: { scanId, googlePlaceId: undefined } },
      },
    },
    include: {
      place: {
        include: {
          reviewThemes: { where: { scanId }, select: { theme: true, sentiment: true, mentionCount: true } },
        },
      },
    },
  });

  // Filter out excluded places
  const excluded = await prisma.excludedPlace.findMany({
    where: { scanId },
    select: { googlePlaceId: true },
  });
  const excludedSet = new Set(excluded.map((e) => e.googlePlaceId));

  return scanPlaces
    .filter((sp) => !excludedSet.has(sp.place.placeId))
    .map((sp) => ({
      placeInternalId: sp.place.id,
      googlePlaceId: sp.place.placeId,
      name: sp.place.name,
      address: sp.place.address,
      googleMapsUri: sp.place.googleMapsUri,
      rating: sp.place.rating,
      reviewCount: sp.place.reviewCount,
      primaryType: sp.place.primaryType,
      reviewThemes: sp.place.reviewThemes
        .filter((t): t is typeof t & { sentiment: string } => t.sentiment != null)
        .map((t) => ({
          theme: t.theme,
          sentiment: t.sentiment,
          mentionCount: t.mentionCount,
        })),
    }));
}

export async function cloneAnalysis(sourceId: string, newOwnerId: string) {
  const source = await prisma.scoutAnalysis.findUniqueOrThrow({
    where: { id: sourceId },
    include: { insights: true },
  });

  return prisma.$transaction(async (tx) => {
    const clone = await tx.scoutAnalysis.create({
      data: {
        scanId: source.scanId,
        ownerId: newOwnerId,
        sourceAnalysisId: source.id,
        status: source.status as AnalysisStatus,
        totalPlaces: source.totalPlaces,
        completedPlaces: source.completedPlaces,
        failedPlaces: source.failedPlaces,
        areaSummary: source.areaSummary ?? Prisma.JsonNull,
        costEstimate: source.costEstimate ?? Prisma.JsonNull,
        inputTokens: 0,
        outputTokens: 0,
        startedAt: source.startedAt,
        finishedAt: source.finishedAt,
      },
    });

    if (source.insights.length > 0) {
      await tx.scoutPlaceInsight.createMany({
        data: source.insights.map((i) => ({
          analysisId: clone.id,
          placeId: i.placeId,
          googlePlaceId: i.googlePlaceId,
          status: i.status as AnalysisStatus,
          retryCount: 0,
          establishedDate: i.establishedDate ?? Prisma.JsonNull,
          popularTimes: i.popularTimes ?? Prisma.JsonNull,
          sentiment: i.sentiment ?? Prisma.JsonNull,
          suitability: i.suitability ?? Prisma.JsonNull,
          rawSources: i.rawSources ?? Prisma.JsonNull,
          editedFields: Prisma.JsonNull,
          inputTokens: 0,
          outputTokens: 0,
          analysedAt: i.analysedAt,
        })),
      });
    }

    return clone;
  });
}

export async function getInsightsToReanalyse(analysisId: string) {
  return prisma.scoutPlaceInsight.findMany({
    where: {
      analysisId,
      OR: [{ editedFields: { equals: Prisma.DbNull } }, { editedFields: { equals: Prisma.JsonNull } }, { editedFields: { equals: {} } }],
    },
    select: { placeId: true, googlePlaceId: true },
  });
}

export async function resetInsightsForReanalysis(analysisId: string, placeIds: string[]) {
  return prisma.scoutPlaceInsight.updateMany({
    where: { analysisId, placeId: { in: placeIds } },
    data: {
      status: "pending",
      establishedDate: Prisma.JsonNull,
      popularTimes: Prisma.JsonNull,
      sentiment: Prisma.JsonNull,
      suitability: Prisma.JsonNull,
      rawSources: Prisma.JsonNull,
      error: null,
      analysedAt: null,
      updatedAt: new Date(),
    },
  });
}
