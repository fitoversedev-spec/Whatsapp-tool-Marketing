import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { checkHotLead } from "@/lib/ai-chats/hotLeads";
import { AgentHttpError } from "./errors";
import { parseId } from "./messaging/access";
import type { AgentHandler } from "./withAgent";
import type { setLeadTemperatureBody } from "./schemas/insights";

/**
 * set_lead_temperature: the AI labels a chat hot / warm / cold for the
 * WhatsApp Marketing → AI agent chats page. A label a person set is never
 * overwritten by the AI (applied: false).
 */
export const setLeadTemperature: AgentHandler<z.infer<typeof setLeadTemperatureBody>> = async ({ ctx, input, params }) => {
  const conversationId = parseId(params.id);
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");

  const existing = await prisma.aiChatInsight.findUnique({ where: { conversationId } });
  if (existing?.source === "human") {
    return {
      body: {
        conversationId,
        applied: false,
        temperature: existing.temperature,
        source: "human",
        message: "A person on the team already labelled this chat; their label is kept.",
      },
      action: "refused:human_label",
      recordIds: [conversationId, existing.id],
    };
  }
  const data = { temperature: input.temperature, reason: input.reason, source: "agent", setByUserId: ctx.userId };
  const row = await prisma.aiChatInsight.upsert({
    where: { conversationId },
    create: { conversationId, ...data },
    update: data,
    select: { id: true },
  });
  if (input.temperature === "HOT") await checkHotLead(conversationId);
  return {
    body: { conversationId, applied: true, temperature: input.temperature, source: "agent" },
    recordIds: [conversationId, row.id],
    fieldsChanged: ["temperature", "reason"],
  };
};
