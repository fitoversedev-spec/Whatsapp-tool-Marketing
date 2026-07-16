// Server-only DB helper for pipeline stages. Keep all Prisma imports here
// so client components can safely import the pure types/helpers from
// pipeline.ts without webpack trying to bundle Prisma for the browser.
//
// Reads the real FunnelStage taxonomy directly — the same 13 rows Team
// Performance's Funnel screen and /deals use, admin-editable via
// /admin/taxonomies. This used to read a separate Setting-row override
// (with a hardcoded 7-stage fallback) via a dedicated /api/pipeline/stages
// endpoint that had no UI ever built for it — removed in favor of the one
// real, already-built taxonomy admin surface, so there's a single source
// of truth instead of two independently-editable stage lists (see
// docs/DECISIONS.md).

import { prisma } from "@/lib/prisma";
import type { PipelineStage } from "./pipeline";

export async function getPipelineStages(): Promise<PipelineStage[]> {
  const stages = await prisma.funnelStage.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return stages.map((s) => ({
    id: s.slug,
    label: s.name,
    color: s.colorHex ?? "#64748b",
    type: s.stageType as PipelineStage["type"],
    order: s.sortOrder,
  }));
}
