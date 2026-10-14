import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approveRequest, REFUSAL_HTTP_STATUS } from "@/lib/agent/approvalRunner";
import { getApproverOrStatus } from "@/lib/agent/approverAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The approved action runs inside this request (up to 25 s).
export const maxDuration = 30;

const bodySchema = z.object({ note: z.string().trim().max(500).optional() });

// POST { note? }: approve one pending request and run it, once.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApproverOrStatus();
  if ("status" in auth) {
    return NextResponse.json({ error: auth.status === 401 ? "Please sign in." : "You are not allowed to decide AI requests." }, { status: auth.status });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "The note is too long (500 characters at most)." }, { status: 400 });

  const outcome = await approveRequest({ id: params.id, approver: auth.user, note: parsed.data.note || null });
  if (!outcome.ok) return NextResponse.json({ error: outcome.message, code: outcome.code }, { status: REFUSAL_HTTP_STATUS[outcome.code] });
  return NextResponse.json({ ok: true, status: outcome.status, failureReason: outcome.failureReason });
}
