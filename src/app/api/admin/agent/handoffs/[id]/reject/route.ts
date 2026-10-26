import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rejectHandoff } from "@/lib/agent/handoffs/admin";
import { getHandoffViewer } from "@/lib/agent/handoffs/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ note: z.string().trim().max(500).optional() });

// POST { note? }: decline the request; the AI agent carries on with the chat.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const viewer = await getHandoffViewer();
  if (!viewer) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "The note is too long (500 characters at most)." }, { status: 400 });
  const outcome = await rejectHandoff({ id: params.id, approver: viewer, note: parsed.data.note || "No reason given." });
  if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
  return NextResponse.json({ ok: true });
}
