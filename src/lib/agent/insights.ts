import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { checkHotLead } from "@/lib/ai-chats/hotLeads";
import { startLeadConversation as startWithWelcome } from "@/lib/ai-chats/welcome";
import { AgentHttpError } from "./errors";
import { parseId, refusal } from "./messaging/access";
import type { AgentHandler } from "./withAgent";
import type { setLeadTemperatureBody, startLeadConversationBody } from "./schemas/insights";

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

/**
 * start_lead_conversation: the first WhatsApp message to a new Meta lead-form
 * lead, using one of the admin's welcome templates (src/lib/ai-chats/welcome.ts).
 * Returns the conversationId to carry on with the normal messaging tools.
 */
export const startLeadConversation: AgentHandler<z.infer<typeof startLeadConversationBody>> = async ({ ctx, input, params }) => {
  const metaLeadId = parseId(params.id);
  const r = await startWithWelcome({ metaLeadId, agentUserId: ctx.userId, templateId: input.templateId, variables: input.variables });
  if (r.ok) return { status: r.status, body: r.body, recordIds: r.recordIds, action: r.status === 200 ? "dedupe:send" : undefined };
  if (r.code === "not_found") throw new AgentHttpError("not_found", r.message);
  if (r.code === "invalid_input") throw new AgentHttpError("invalid_input", r.message);
  const refused = refusal(ctx, r.code, r.message, r.status, [metaLeadId]);
  // e.g. already_chatting carries the conversationId to reply in.
  const body = refused.body as { error: Record<string, unknown> };
  if (r.extra) body.error = { ...body.error, ...r.extra };
  return refused;
};
