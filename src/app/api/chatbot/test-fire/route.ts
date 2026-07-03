// Admin-only chatbot dispatch tester. Simulates an inbound WhatsApp
// message to your own phone — the dispatcher runs end-to-end so real
// WhatsApp messages are actually sent (menu list, catalogue PDF, etc.).
// Use this to step through the multi-turn flow without waiting for
// Meta's webhook to trigger.
//
// Body: { phone, text?, replyId?, reset? }
//   - text: simulate a customer typing free text
//   - replyId: simulate a customer tapping a button/list row
//     (must match one of the ids in steps.ts, e.g. "menu:turnkey_new")
//   - reset: true to force-close any active flow before firing

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dispatchChatbot } from "@/lib/chatbot/dispatch";

const schema = z.object({
  phone: z.string().min(5).max(20),
  text: z.string().max(500).optional(),
  replyId: z.string().max(100).optional(),
  reset: z.boolean().optional(),
});

function normalize(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!parsed.data.text && !parsed.data.replyId && !parsed.data.reset) {
    return NextResponse.json(
      { error: "provide text, replyId, or reset" },
      { status: 400 }
    );
  }

  const phone = normalize(parsed.data.phone);
  if (phone.length < 10) {
    return NextResponse.json({ error: "phone_too_short" }, { status: 400 });
  }

  // Find or create the conversation.
  let convo = await prisma.conversation.findFirst({
    where: { contactPhone: phone },
    select: { id: true },
  });
  if (!convo) {
    convo = await prisma.conversation.create({
      data: {
        contactPhone: phone,
        contactName: "Test contact",
        status: "open",
      },
      select: { id: true },
    });
  }

  // Reset support: kill any active flow so the next inbound starts fresh.
  if (parsed.data.reset) {
    await prisma.conversationFlow
      .updateMany({
        where: { conversationId: convo.id, endedAt: null },
        data: { endedAt: new Date(), endReason: "off_script" },
      })
      .catch(() => null);
    if (!parsed.data.text && !parsed.data.replyId) {
      return NextResponse.json({ ok: true, reset: true });
    }
  }

  const handled = await dispatchChatbot({
    conversationId: convo.id,
    contactPhone: phone,
    inboundBody: parsed.data.text ?? parsed.data.replyId ?? "",
    interactiveReplyId: parsed.data.replyId ?? null,
  });

  const flow = await prisma.conversationFlow.findUnique({
    where: { conversationId: convo.id },
  });

  return NextResponse.json({
    ok: true,
    handled,
    flow: flow
      ? {
          currentStep: flow.currentStep,
          path: flow.path,
          collectedData: JSON.parse(flow.collectedData),
          endedAt: flow.endedAt,
          endReason: flow.endReason,
        }
      : null,
  });
}
