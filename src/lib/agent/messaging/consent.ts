import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { AgentHttpError } from "../errors";
import type { AgentHandler } from "../withAgent";
import type { consentOffBody, recordOptOutBody } from "../schemas/messaging";

/**
 * The only two consent-changing tools, and both can only make things MORE
 * restrictive. There is deliberately no tool to re-subscribe, grant consent or
 * delete an OptOut; resubscribe_contact is registered as NEVER and has no route.
 */

type Target = { phone: string; contactName: string | null; conversationId: string | null };

async function resolveTarget(input: { phone?: string; conversationId?: string }): Promise<Target> {
  if (input.conversationId) {
    const convo = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, contactPhone: true, contactName: true },
    });
    if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");
    return {
      phone: normalizePhone(convo.contactPhone) ?? convo.contactPhone,
      contactName: convo.contactName,
      conversationId: convo.id,
    };
  }
  const phone = normalizePhone(input.phone ?? "");
  if (!phone) throw new AgentHttpError("invalid_input", "`phone` is not a valid phone number.");
  return { phone, contactName: null, conversationId: null };
}

/**
 * Same write as the webhook's "stop" handling (OptOut keyed by the E.164 number
 * without +), but an existing opt-out is left exactly as it was, so repeating
 * the call changes nothing and cannot overwrite the original reason or date.
 */
export const recordOptOutHandler: AgentHandler<z.infer<typeof recordOptOutBody>> = async ({ input }) => {
  const target = await resolveTarget(input);
  const existing = await prisma.optOut.findUnique({
    where: { phoneE164: target.phone },
    select: { phoneE164: true },
  });
  await prisma.optOut.upsert({
    where: { phoneE164: target.phone },
    create: { phoneE164: target.phone, reason: `agent: ${input.reason}`.slice(0, 200) },
    update: {},
  });
  return {
    body: { phone: target.phone, optedOut: true, alreadyOptedOut: !!existing },
    recordIds: target.conversationId ? [target.conversationId] : [],
    fieldsChanged: existing ? [] : ["opt_out"],
  };
};

/**
 * Sets Contact.allowCampaign = false. If the number has no marketing contact yet
 * one is created with consent off, so a later import cannot quietly default it
 * back to "allowed".
 */
export const consentOffHandler: AgentHandler<z.infer<typeof consentOffBody>> = async ({ input }) => {
  const target = await resolveTarget(input);
  const existing = await prisma.contact.findUnique({ where: { phone: target.phone }, select: { id: true } });
  const contact = await prisma.contact.upsert({
    where: { phone: target.phone },
    create: { phone: target.phone, name: target.contactName, allowCampaign: false },
    update: { allowCampaign: false },
    select: { id: true },
  });
  return {
    body: { phone: target.phone, allowCampaign: false, created: !existing },
    recordIds: [contact.id],
    fieldsChanged: ["allowCampaign"],
  };
};
