import "server-only";

import { prisma } from "@/lib/prisma";
import { startOfDayIST } from "@/lib/time";
import { AiError } from "@/lib/ai/errors";

export const AI_ANALYSIS_DAILY_CAP = 50;

export async function assertWithinAnalysisCap(userId: string): Promise<void> {
  const since = startOfDayIST(new Date());
  const count = await prisma.aiUsage.count({
    where: {
      userId,
      feature: { startsWith: "scout-analysis" },
      createdAt: { gte: since },
    },
  });
  if (count >= AI_ANALYSIS_DAILY_CAP) {
    throw new AiError("Daily AI analysis limit reached — try again tomorrow", "limit");
  }
}
