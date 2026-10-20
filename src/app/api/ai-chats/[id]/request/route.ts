import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requestHotLead } from "@/lib/ai-chats/hotLeads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST: a salesperson asks an admin for an unassigned hot AI lead.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const outcome = await requestHotLead({ id: user.id, role: user.role, name: user.name }, params.id);
  if (!outcome.ok) return NextResponse.json({ error: outcome.message }, { status: outcome.status });
  return NextResponse.json({ ok: true });
}
