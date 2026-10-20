import { NextResponse } from "next/server";
import { releaseHandoff } from "@/lib/agent/handoffs/admin";
import { getHandoffViewer } from "@/lib/agent/handoffs/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST: hand an assigned chat back to the AI agent (assigned salesperson or an approver).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const viewer = await getHandoffViewer();
  if (!viewer) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const outcome = await releaseHandoff({ id: params.id, user: viewer });
  if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
  return NextResponse.json({ ok: true });
}
