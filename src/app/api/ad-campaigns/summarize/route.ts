// Phase 6 (Meta ad-campaign AI summaries) — the one route. Read-only reporting:
// it asks the model a natural-language question and lets it answer only by
// calling the Meta ads tools (report.ts / toolbox.ts), so nothing here invents
// numbers or touches a customer. Auth is a real 401 JSON response (not
// next/navigation's redirect(), which is for pages). Open to any approved user
// (all reps) — ad-campaign data is not rep-scoped, and this is internal-assist.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { AiError, aiErrorStatus } from "@/lib/ai/errors";
import { runMetaAdsReport } from "@/lib/ai/meta/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Aggregate ad metrics aren't rep-owned (any approved user may ask), but the
  // find_lead record lookup IS scoped: resolveAnalyticsScope forces a non-admin
  // to their own CRM-linked leads, admins get company-wide.
  const scope = resolveAnalyticsScope({ id: user.id, role: user.role as Role });

  let body: { question?: unknown };
  try {
    body = (await req.json()) as { question?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "A question is required" }, { status: 400 });

  try {
    const result = await runMetaAdsReport({ userId: user.id, question, scope });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ error: e.message }, { status: aiErrorStatus(e.code) });
    throw e;
  }
}
