// Server-only DB helpers for pipeline stages. Keep all Prisma imports here
// so client components can safely import the pure types/helpers from
// pipeline.ts without webpack trying to bundle Prisma for the browser.

import { prisma } from "@/lib/prisma";
import { DEFAULT_STAGES, type PipelineStage } from "./pipeline";

const STAGES_KEY = "pipeline_stages";

export async function getPipelineStages(): Promise<PipelineStage[]> {
  const row = await prisma.setting.findUnique({ where: { key: STAGES_KEY } });
  if (!row) return DEFAULT_STAGES;
  try {
    const parsed = JSON.parse(row.value) as PipelineStage[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_STAGES;
    return parsed.sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_STAGES;
  }
}

export async function setPipelineStages(stages: PipelineStage[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: STAGES_KEY },
    create: { key: STAGES_KEY, value: JSON.stringify(stages) },
    update: { value: JSON.stringify(stages) },
  });
}
