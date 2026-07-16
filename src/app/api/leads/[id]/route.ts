import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  status: z
    .enum(["new", "in_progress", "contacted", "converted", "lost"])
    .optional(),
  assignedToUserId: z.string().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Sales + admin can edit any lead; anyone else is blocked.
  if (user.role !== "admin" && user.role !== "sales") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const lead = await prisma.botLead.findUnique({ where: { id: params.id } });
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.botLead.update({
    where: { id: params.id },
    data: parsed.data,
  });

  // Bridge to the mirrored general-CRM Lead row (BotLead.leadId) — best
  // effort, never blocks this response. Before this, claiming a chatbot
  // lead here only ever set BotLead.assignedToUserId; the linked Lead's
  // ownerUserId stayed null forever (chatbot-created Lead rows are never
  // given an owner at creation either, since there's no real actor at
  // automated-capture time — see src/lib/chatbot/dispatch.ts). Every
  // chatbot lead a rep claimed was therefore permanently invisible to
  // sourceAnalytics()'s per-rep filtering in Team Performance, with no way
  // to ever fix it short of a raw DB edit. See docs/DECISIONS.md.
  if (parsed.data.assignedToUserId !== undefined && lead.leadId) {
    await prisma.lead
      .update({ where: { id: lead.leadId }, data: { ownerUserId: parsed.data.assignedToUserId } })
      .catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
