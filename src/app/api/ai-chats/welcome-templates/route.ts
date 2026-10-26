import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getHandoffViewer } from "@/lib/agent/handoffs/viewer";
import { listTemplateChoices, loadWelcomeTemplateIds, saveWelcomeTemplateIds } from "@/lib/ai-chats/welcome";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The welcome templates the AI may send to new lead-form leads on its own.
// Same people who decide AI requests (admins by default).
async function approverOr401() {
  const viewer = await getHandoffViewer();
  if (!viewer) return { error: NextResponse.json({ error: "Please sign in." }, { status: 401 }) };
  if (!viewer.approver) return { error: NextResponse.json({ error: "Only admins can change this." }, { status: 403 }) };
  return { viewer };
}

export async function GET() {
  const auth = await approverOr401();
  if ("error" in auth) return auth.error;
  const [selected, templates] = await Promise.all([loadWelcomeTemplateIds(), listTemplateChoices()]);
  return NextResponse.json({ selected, templates });
}

const bodySchema = z.object({ templateIds: z.array(z.string().min(1).max(64)).max(10) });

export async function PUT(req: NextRequest) {
  const auth = await approverOr401();
  if ("error" in auth) return auth.error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick up to 10 templates." }, { status: 400 });
  const approved = new Set((await listTemplateChoices()).map((t) => t.id));
  const ids = parsed.data.templateIds.filter((id) => approved.has(id));
  await saveWelcomeTemplateIds(ids);
  return NextResponse.json({ ok: true, selected: ids });
}
