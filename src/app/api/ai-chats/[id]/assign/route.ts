import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assignChat } from "@/lib/agent/handoffs/admin";
import { getHandoffViewer } from "@/lib/agent/handoffs/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  assignToUserId: z.string().min(1).max(64),
  note: z.string().trim().max(500).optional(),
});

// POST { assignToUserId, note? }: an admin gives an AI lead to a salesperson directly.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await getHandoffViewer();
  if (!viewer) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick a salesperson." }, { status: 400 });
  const outcome = await assignChat({
    conversationId: params.id,
    approver: viewer,
    assignToUserId: parsed.data.assignToUserId,
    note: parsed.data.note || null,
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
  return NextResponse.json({ ok: true });
}
