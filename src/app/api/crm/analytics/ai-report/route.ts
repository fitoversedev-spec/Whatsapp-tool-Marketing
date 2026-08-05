// Feature 2 (AI analytics reports) — the one route. Admin-only, read-only
// reporting: it asks the model a natural-language question and lets it answer
// only by calling the analytics tools (report.ts / toolbox.ts), so nothing here
// invents numbers or touches a customer. Auth is a real 401/403 JSON response
// (not next/navigation's redirect(), which is for pages) — same gate as
// /api/crm/analytics/patterns. resolveAnalyticsScope() is still applied and
// passed to the toolbox for defence-in-depth even though only admins reach here.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { AiError, aiErrorStatus } from "@/lib/ai/errors";
import { runAiReport } from "@/lib/ai/analytics/report";
import { renderAiReportPdf } from "@/lib/ai/analytics/report-pdf";
import { coercePeriodInput } from "@/lib/ai/analytics/toolbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Open to all approved users. resolveAnalyticsScope forces a non-admin to
  // their OWN deals only (admins get company-wide), so reps can safely ask and
  // only ever see their own numbers.
  const scope = resolveAnalyticsScope({ id: user.id, role: user.role as Role });

  let body: { question?: unknown; period?: unknown };
  try {
    body = (await req.json()) as { question?: unknown; period?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "A question is required" }, { status: 400 });
  const period = coercePeriodInput(body.period);

  try {
    const result = await runAiReport({ userId: user.id, question, period, scope });

    if (req.nextUrl.searchParams.get("format") === "pdf") {
      const pdf = await renderAiReportPdf({
        question,
        narrative: result.narrative,
        dataBlocks: result.dataBlocks,
      });
      return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="ai-analytics-report.pdf"',
        },
      });
    }

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ error: e.message }, { status: aiErrorStatus(e.code) });
    throw e;
  }
}
