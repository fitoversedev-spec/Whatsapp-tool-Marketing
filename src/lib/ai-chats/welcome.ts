/**
 * The AI's first WhatsApp message to a Meta lead-form lead (Instagram /
 * Facebook instant form). A form lead has no WhatsApp chat yet and is outside
 * the 24 h window, so the first message must be an approved template.
 *
 * An admin picks the allowed "welcome" templates once (Setting
 * agent_welcome_templates, edited on the AI agent chats page). The AI may then
 * send one of them to each new form lead without waiting for approval — once
 * per lead, never to an opted-out number. Direct WhatsApp messages need none of
 * this: the customer opened the window, so the AI simply replies.
 */
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { findExistingOwner, OWNER_SOURCE_LABEL, phoneVariants } from "./owners";
import { describeMetaError, isMetaConfigured, sendTemplate } from "@/lib/whatsapp";
import {
  buildTemplateComponents,
  expectedVariableCount,
  isApprovedStatus,
  renderTemplateText,
  validateVariables,
} from "@/lib/agent/messaging/templates";

export const WELCOME_SETTING_KEY = "agent_welcome_templates";
const WINDOW_MS = 24 * 60 * 60 * 1000;
/** Someone on the team (or a broadcast) messaged this number this recently: no welcome on top. */
const RECENT_CONTACT_MS = 7 * 24 * 60 * 60 * 1000;

/** Why the AI did not send a welcome (stored as ai_lead_outreach.status "skipped:<reason>"). */
export type SkipReason = "already_assigned" | "already_welcomed" | "contacted_recently";

export function parseWelcomeSetting(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "{}") as { templateIds?: unknown };
    return Array.isArray(v.templateIds) ? v.templateIds.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

export async function loadWelcomeTemplateIds(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: WELCOME_SETTING_KEY } });
  return parseWelcomeSetting(row?.value);
}

export async function saveWelcomeTemplateIds(ids: string[]): Promise<void> {
  const value = JSON.stringify({ templateIds: [...new Set(ids)].slice(0, 10) });
  await prisma.setting.upsert({ where: { key: WELCOME_SETTING_KEY }, create: { key: WELCOME_SETTING_KEY, value }, update: { value } });
}

/** Approved, not-deleted templates an admin can choose from. */
export async function listTemplateChoices() {
  const rows = await prisma.template.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true, language: true, body: true, status: true },
  });
  return rows.filter((t) => isApprovedStatus(t.status)).map(({ status: _s, ...t }) => t);
}

/** Default variables when the agent sends none: {{1}} = the lead's first name. */
export function defaultVariables(body: string, fullName: string | null): string[] | null {
  const n = expectedVariableCount(body);
  if (n === 0) return [];
  if (n === 1) return [fullName?.trim().split(/\s+/)[0] || "there"];
  return null;
}

export type StartResult =
  | { ok: true; status: 200 | 201; body: Record<string, unknown>; recordIds: string[] }
  | { ok: false; status: number; code: string; message: string; extra?: Record<string, unknown> };

/**
 * Send the welcome template to Meta lead `metaLeadId` and open its WhatsApp chat.
 * `agentUserId` is the AI's service user (the sender recorded on the message).
 */
export async function startLeadConversation(args: {
  metaLeadId: string;
  agentUserId: string;
  templateId?: string;
  variables?: string[];
}): Promise<StartResult> {
  const lead = await prisma.metaLead.findUnique({
    where: { id: args.metaLeadId },
    select: { id: true, fullName: true, phone: true, normalizedPhone: true, stage: true },
  });
  if (!lead) return { ok: false, status: 404, code: "not_found", message: "Ad lead not found." };

  // Once per lead: an earlier send, skip (or one in flight) is returned as-is.
  const earlier = await prisma.aiLeadOutreach.findUnique({ where: { metaLeadId: lead.id } });
  if (earlier) {
    const skipped = earlier.status.startsWith("skipped:") ? earlier.status.slice("skipped:".length) : null;
    return {
      ok: true,
      status: 200,
      body: {
        sent: earlier.status === "sent",
        deduplicated: true,
        ...(skipped ? { skipped } : {}),
        conversationId: earlier.conversationId,
        templateId: earlier.templateId || null,
      },
      recordIds: [lead.id, earlier.id],
    };
  }

  const phone = normalizePhone(lead.normalizedPhone ?? lead.phone ?? "");
  if (!phone) return { ok: false, status: 422, code: "no_phone", message: "This lead has no usable phone number." };
  const optedOut = await prisma.optOut.findFirst({ where: { phoneE164: { in: [phone, `+${phone}`] } }, select: { phoneE164: true } });
  if (optedOut) return { ok: false, status: 403, code: "opted_out", message: "This number has opted out. The AI never messages it." };

  // A lead not to message is recorded as skipped, so asking again for this lead returns the same answer.
  const skip = async (reason: SkipReason, conversationId: string | null, extra: Record<string, unknown> = {}): Promise<StartResult> => {
    const row = await prisma.aiLeadOutreach
      .create({ data: { metaLeadId: lead.id, templateId: "", status: `skipped:${reason}`, conversationId }, select: { id: true } })
      .catch(() => null); // a parallel call recorded it first: same answer
    return {
      ok: true,
      status: 200,
      body: { sent: false, deduplicated: false, skipped: reason, conversationId, templateId: null, ...extra },
      recordIds: row ? [lead.id, row.id] : [lead.id],
    };
  };

  const existing = await prisma.conversation.findFirst({
    where: { contactPhone: { in: phoneVariants(phone) } },
    select: { id: true, contactPhone: true, lastInboundAt: true, lastOutboundAt: true },
  });

  // Never two people contacting one customer: a salesperson already has them.
  const owner = await findExistingOwner(phone);
  if (owner) {
    return skip("already_assigned", existing?.id ?? null, {
      assignedTo: { name: owner.name, source: OWNER_SOURCE_LABEL[owner.source] },
    });
  }

  if (existing?.lastInboundAt && Date.now() - existing.lastInboundAt.getTime() < WINDOW_MS) {
    return {
      ok: false,
      status: 409,
      code: "already_chatting",
      message: "This customer is already chatting on WhatsApp (24 h window open). Reply with send_reply instead.",
      extra: { conversationId: existing.id },
    };
  }

  // One welcome per person, not per form fill: repeat leads share the phone (and the chat).
  if (existing) {
    const welcomed = await prisma.aiLeadOutreach.findFirst({ where: { conversationId: existing.id, status: "sent" }, select: { id: true } });
    if (welcomed) return skip("already_welcomed", existing.id);
    if (existing.lastOutboundAt && Date.now() - existing.lastOutboundAt.getTime() < RECENT_CONTACT_MS) {
      return skip("contacted_recently", existing.id);
    }
  }

  const allowed = await loadWelcomeTemplateIds();
  if (!allowed.length) {
    return { ok: false, status: 409, code: "no_welcome_template", message: "No welcome template is set. An admin picks them on WhatsApp Marketing → AI agent chats." };
  }
  const templateId = args.templateId ?? allowed[0];
  if (!allowed.includes(templateId)) {
    return { ok: false, status: 422, code: "template_not_allowed", message: "That template is not on the admin's welcome list.", extra: { allowed } };
  }
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, language: true, header: true, body: true, status: true, deletedAt: true },
  });
  if (!template || template.deletedAt || !isApprovedStatus(template.status)) {
    return { ok: false, status: 422, code: "template_not_approved", message: "The welcome template is missing or not approved by WhatsApp." };
  }
  const variables = args.variables ?? defaultVariables(template.body, lead.fullName);
  if (!variables) {
    return { ok: false, status: 400, code: "invalid_input", message: "This template needs more than one variable; send `variables`." };
  }
  const check = validateVariables(template.body, variables);
  if (!check.ok) return { ok: false, status: 400, code: "invalid_input", message: check.message };
  if (!(await isMetaConfigured())) return { ok: false, status: 503, code: "internal", message: "WhatsApp sending is not configured." };

  // Claim the lead first so two calls can never both send.
  let claim: { id: string };
  try {
    claim = await prisma.aiLeadOutreach.create({ data: { metaLeadId: lead.id, templateId: template.id }, select: { id: true } });
  } catch (err) {
    // Lost the race to another call: return its result. Anything else is a real error.
    if (await prisma.aiLeadOutreach.findUnique({ where: { metaLeadId: lead.id }, select: { id: true } })) {
      return startLeadConversation(args);
    }
    throw err;
  }

  let waMessageId: string;
  try {
    const components = buildTemplateComponents(template.header, template.body, variables);
    ({ waMessageId } = await sendTemplate({ to: phone, templateName: template.name, language: template.language, components }));
  } catch (err) {
    await prisma.aiLeadOutreach.delete({ where: { id: claim.id } }).catch(() => undefined);
    const e = describeMetaError(err);
    return { ok: false, status: 502, code: "send_failed", message: `WhatsApp rejected the message (${e.code}): ${e.message}`.slice(0, 300) };
  }

  const now = new Date();
  const convo = await prisma.conversation.upsert({
    // Reuse the person's existing chat, whatever spelling its phone was stored under.
    where: { contactPhone: existing?.contactPhone ?? phone },
    create: { contactPhone: phone, contactName: lead.fullName ?? null, lastOutboundAt: now },
    update: { lastOutboundAt: now },
    select: { id: true },
  });
  const rendered = renderTemplateText(template.body, variables);
  const message = await prisma.message.create({
    data: {
      conversationId: convo.id,
      direction: "outbound",
      type: "template",
      body: rendered,
      templateId: template.id,
      waMessageId: waMessageId || null,
      status: "sent",
      sentByUserId: args.agentUserId,
    },
    select: { id: true },
  });
  await prisma.aiLeadOutreach.update({
    where: { id: claim.id },
    data: { status: "sent", conversationId: convo.id, waMessageId: waMessageId || null, sentAt: now },
  });
  // The ad lead now reads as contacted (only if nobody moved it on already).
  await prisma.metaLead.updateMany({ where: { id: lead.id, stage: "NEW" }, data: { stage: "CONTACTED" } });

  return {
    ok: true,
    status: 201,
    body: { sent: true, deduplicated: false, conversationId: convo.id, templateId: template.id, text: rendered },
    recordIds: [lead.id, convo.id, message.id],
  };
}
