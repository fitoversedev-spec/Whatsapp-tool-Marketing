import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canLabelChat, findVisibleChat } from "@/lib/ai-chats/query";
import { checkHotLead } from "@/lib/ai-chats/hotLeads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  // null clears the label: the chat goes back to the automatic score.
  temperature: z.enum(["HOT", "WARM", "COLD"]).nullable(),
  reason: z.string().trim().max(500).optional(),
});

// PUT { temperature, reason? }: a person labels an AI chat hot / warm / cold.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const convo = await findVisibleChat(user, params.id);
  if (!convo) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  if (!canLabelChat(user, convo.assignedToUserId)) {
    return NextResponse.json({ error: "Only an admin, a manager or the assigned salesperson can change this." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick hot, warm or cold." }, { status: 400 });

  if (parsed.data.temperature === null) {
    await prisma.aiChatInsight.deleteMany({ where: { conversationId: convo.id } });
    return NextResponse.json({ ok: true });
  }
  const data = {
    temperature: parsed.data.temperature,
    reason: parsed.data.reason || `Set by ${user.name}`,
    source: "human",
    setByUserId: user.id,
  };
  await prisma.aiChatInsight.upsert({
    where: { conversationId: convo.id },
    create: { conversationId: convo.id, ...data },
    update: data,
  });
  if (data.temperature === "HOT") await checkHotLead(convo.id);
  return NextResponse.json({ ok: true });
}
