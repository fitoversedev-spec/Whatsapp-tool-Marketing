import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { draftTemplate, type TemplateTone } from "@/lib/ai/templates/draft";
import { AiError, aiErrorStatus } from "@/lib/ai/errors";

// AI drafts an editable WhatsApp template for the rep to review and submit to
// Meta — internal-assist only, nothing here is sent to a customer. Open to any
// approved rep (no admin gate).
export const runtime = "nodejs";

const TONES: TemplateTone[] = ["professional", "friendly", "urgent"];

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
  if (!brief) {
    return NextResponse.json({ error: "brief is required" }, { status: 400 });
  }

  const sport =
    typeof body?.sport === "string" && body.sport.trim()
      ? body.sport.trim()
      : undefined;
  const tone = TONES.includes(body?.tone) ? (body.tone as TemplateTone) : undefined;

  try {
    const draft = await draftTemplate({ userId: user.id, brief, sport, tone });
    return NextResponse.json({ draft });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message }, { status: aiErrorStatus(e.code) });
    }
    throw e;
  }
}
