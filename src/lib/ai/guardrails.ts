// Cost guardrails for the AI layer: a soft per-user daily request cap so a
// runaway can never rack up spend, plus a best-effort usage log (the same
// table powers a future "AI spend" view). Both read/write the ai_usage table.
import { prisma } from "@/lib/prisma";
import { startOfDayIST } from "@/lib/time";
import { AiError } from "./errors";

export const AI_MAX_TOKENS_DEFAULT = 4000;
// Generous for normal use (a rep might draft a handful of templates a day; an
// admin might run a dozen reports). Well below anything that would cost real
// money, but stops a stuck client from looping forever.
export const AI_DAILY_REQUEST_CAP = 200;

// Throws AiError("limit") (→ 429) when the user has already made
// AI_DAILY_REQUEST_CAP requests since the start of the IST day.
export async function assertWithinDailyCap(userId: string): Promise<void> {
  const since = startOfDayIST(new Date());
  const count = await prisma.aiUsage.count({
    where: { userId, createdAt: { gte: since } },
  });
  if (count >= AI_DAILY_REQUEST_CAP) {
    throw new AiError("Daily AI limit reached — try again tomorrow", "limit");
  }
}

// Records token usage for cost visibility + the daily cap. Best-effort:
// logging must never break the actual request, so it swallows errors.
export async function logAiUsage(p: {
  userId: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  try {
    await prisma.aiUsage.create({
      data: {
        userId: p.userId,
        feature: p.feature,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
      },
    });
  } catch {
    /* never throw from usage logging */
  }
}
