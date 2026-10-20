import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { claimHotLead } from "@/lib/ai-chats/hotLeads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST: a salesperson takes an unassigned hot AI chat (first click wins).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const outcome = await claimHotLead({ id: user.id, role: user.role, name: user.name }, params.id);
  if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
  return NextResponse.json({ ok: true });
}
