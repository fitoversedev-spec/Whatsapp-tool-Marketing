// Single decision-log-write chokepoint (Phase 5 insight engine) — mirrors
// src/lib/audit.ts. Records the human decision an insight led to (or a
// standalone call) so the digest/insight feed can close the loop. Best-effort:
// a decision-log-write failure must never fail the caller it's describing.
import { prisma } from "@/lib/prisma";
import type { DecisionLog } from "@prisma/client";

export async function writeDecision(args: {
  recordedByUserId: string;
  decision: string;
  triggeredByInsightId?: string | null;
  decidedAt?: Date;
}): Promise<void> {
  await prisma.decisionLog
    .create({
      data: {
        recordedByUserId: args.recordedByUserId,
        decision: args.decision,
        triggeredByInsightId: args.triggeredByInsightId ?? null,
        decidedAt: args.decidedAt ?? new Date(),
      },
    })
    .catch((err) => console.error("[decisionLog] write failed", err));
}

export async function listDecisions(limit?: number): Promise<DecisionLog[]> {
  return prisma.decisionLog.findMany({
    orderBy: { decidedAt: "desc" },
    ...(limit !== undefined ? { take: limit } : {}),
  });
}
