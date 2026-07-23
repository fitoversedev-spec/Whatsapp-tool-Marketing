// Decision Log (Phase 5 analytics v2) — the human decisions the insight feed
// led to, closing the loop from "here's a signal + recommended action" to
// "here's what we decided to do about it". Admin-only, mirroring
// /api/admin/targets/route.ts's non-redirect JSON auth pattern exactly
// (getCurrentUser + isAdmin + 403 — requireAdmin() calls next/navigation's
// redirect(), which is for pages, not JSON routes).
//
// All writes go through writeDecision (src/lib/decisionLog.ts), the single
// decision-log-write chokepoint that mirrors src/lib/audit.ts — the route never
// touches prisma.decisionLog.create directly.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { writeDecision, listDecisions } from "@/lib/decisionLog";

export const runtime = "nodejs";

const createSchema = z.object({
  decision: z.string().trim().min(1).max(2000),
  // Optional link to the Insight this decision responded to. Free-form because
  // an Insight id is a deterministic `${rule}:${subject}` string (insights.ts),
  // not a DB row, so there's no FK to validate against — just a non-empty cap.
  triggeredByInsightId: z.string().trim().min(1).max(200).nullable().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const decisions = await listDecisions(100);

  // Enrich each row with the recorder's display name in one batched lookup
  // (same "resolve ids to names" shape /api/admin/targets leaves to the client
  // via /api/users/assignable, done server-side here to keep the client tab a
  // single fetch).
  const recorderIds = [...new Set(decisions.map((d) => d.recordedByUserId))];
  const recorders = await prisma.user.findMany({
    where: { id: { in: recorderIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(recorders.map((u) => [u.id, u.name]));

  return NextResponse.json({
    decisions: decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      triggeredByInsightId: d.triggeredByInsightId,
      decidedAt: d.decidedAt.toISOString(),
      recordedByUserId: d.recordedByUserId,
      recordedByName: nameById.get(d.recordedByUserId) ?? "Unknown",
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  await writeDecision({
    recordedByUserId: user.id,
    decision: parsed.data.decision,
    triggeredByInsightId: parsed.data.triggeredByInsightId ?? null,
  });

  return NextResponse.json({ ok: true });
}
