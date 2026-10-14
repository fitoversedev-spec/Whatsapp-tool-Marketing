import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rejectRequest, REFUSAL_HTTP_STATUS } from "@/lib/agent/approvalRunner";
import { getApproverOrStatus } from "@/lib/agent/approverAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ note: z.string().trim().min(1).max(500) });

// POST { note }: reject one pending request. Nothing is run. A note is required.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApproverOrStatus();
  if ("status" in auth) {
    return NextResponse.json({ error: auth.status === 401 ? "Please sign in." : "You are not allowed to decide AI requests." }, { status: auth.status });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Please write a short reason (500 characters at most)." }, { status: 400 });

  const outcome = await rejectRequest({ id: params.id, approver: auth.user, note: parsed.data.note });
  if (!outcome.ok) return NextResponse.json({ error: outcome.message, code: outcome.code }, { status: REFUSAL_HTTP_STATUS[outcome.code] });
  return NextResponse.json({ ok: true });
}
