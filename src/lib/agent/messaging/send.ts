import type { Prisma } from "@prisma/client";
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { describeMetaError, isMetaConfigured, sendTemplate, sendText } from "@/lib/whatsapp";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import type { AgentHandler, AgentHandlerResult } from "../withAgent";
import type { sendMarketingTemplateBody, sendReplyBody, sendTemplateBody } from "../schemas/messaging";
import { holdForApproval, loadEligibility, MESSAGE_SELECT, parseId, refusal, toMessageDto } from "./access";
import { detectSensitiveContent } from "./contentGuard";
import { DEDUPE_WINDOW_MS, findDuplicate } from "./dedupe";
import { chargeConversationLimit } from "./limits";
import {
  buildTemplateComponents,
  isApprovedStatus,
  renderTemplateText,
  routeTemplateCategory,
  validateVariables,
  type TemplateTool,
} from "./templates";

/**
 * send_reply, send_template and send_marketing_template.
 *
 * Order of checks (cheapest and most absolute first): opted out (never send) ->
 * 24 h window / template rules -> price-or-promise guard (held for a human) ->
 * duplicate within 10 min -> per-conversation hourly limit -> send -> mirror.
 * The recipient is ALWAYS the conversation's own phone; no input can name one.
 *
 * AI-sent messages are saved with sentByUserId = the agent's service user, the
 * same column the inbox already uses for "who sent this".
 */

const OPTED_OUT_MESSAGE = "This contact has opted out. The AI agent never messages opted-out contacts.";

type Sent = { waMessageId: string } | { failed: AgentHandlerResult };

/** Call WhatsApp. A timeout means "maybe delivered": refuse to guess and let the caller look. */
async function dispatch(
  ctx: AgentContext,
  conversationId: string,
  send: () => Promise<{ waMessageId: string }>,
): Promise<Sent> {
  if (!(await isMetaConfigured())) throw new AgentHttpError("internal", "WhatsApp sending is not configured.", 503);
  try {
    return await send();
  } catch (err) {
    const e = describeMetaError(err);
    if (e.code === "timeout") {
      return {
        failed: refusal(
          ctx,
          "delivery_unknown",
          "WhatsApp did not answer in time; the message may or may not have been delivered. Check get_messages before sending again.",
          409,
          [conversationId],
        ),
      };
    }
    throw new AgentHttpError("internal", `WhatsApp rejected the message (${e.code}): ${e.message}`.slice(0, 300), 502);
  }
}

/**
 * Save what was sent so the inbox shows it. If saving fails AFTER WhatsApp
 * accepted the message we must not fail the request (a retry would send it
 * again), so the error is logged and reported as mirrored:false.
 */
async function mirror(conversationId: string, data: Prisma.MessageUncheckedCreateInput) {
  let message = null;
  try {
    message = await prisma.message.create({ data, select: MESSAGE_SELECT });
  } catch (error) {
    console.error("[agent] message sent but not saved", { conversationId, error: (error as Error)?.name });
  }
  try {
    // Last-message field only. The human route also auto-assigns an unassigned
    // chat to the sender; the AI must not claim chats, so that part is skipped.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
      select: { id: true },
    });
  } catch (error) {
    console.error("[agent] conversation not updated after send", { conversationId, error: (error as Error)?.name });
  }
  return message;
}

function sentBody(
  ctx: AgentContext,
  message: Awaited<ReturnType<typeof mirror>>,
  waMessageId: string,
  reference: string | null,
) {
  return {
    sent: true,
    duplicate: false,
    mirrored: !!message,
    waMessageId: waMessageId || null,
    reference,
    message: message ? toMessageDto(message, ctx.userId) : null,
  };
}

// ---- send_reply ------------------------------------------------------------

export const sendReplyHandler: AgentHandler<z.infer<typeof sendReplyBody>> = async ({ ctx, input, params }) => {
  const id = parseId(params.id);
  const reference = input.reference ?? null;
  const convo = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, contactPhone: true, lastInboundAt: true },
  });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");

  const now = Date.now();
  const elig = await loadEligibility(convo, now);
  if (elig.optedOut) return refusal(ctx, "opted_out", OPTED_OUT_MESSAGE, 403, [id]);
  if (!elig.windowOpen) {
    return refusal(
      ctx,
      "window_closed",
      "The 24-hour reply window is closed. Use send_template with an approved template instead.",
      409,
      [id],
    );
  }

  const guard = detectSensitiveContent(input.text);
  if (guard.flagged) {
    return holdForApproval(ctx, "send_reply", { conversationId: id, text: input.text, reference }, guard.categories, [id]);
  }

  const recent = await prisma.message.findMany({
    where: {
      conversationId: id,
      direction: "outbound",
      type: "text",
      createdAt: { gte: new Date(now - DEDUPE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: MESSAGE_SELECT,
  });
  const dup = findDuplicate(recent, input.text, now);
  if (dup) {
    return {
      body: {
        sent: false,
        duplicate: true,
        mirrored: true,
        waMessageId: null,
        reference,
        message: toMessageDto(dup, ctx.userId),
      },
      recordIds: [id, dup.id],
    };
  }

  const charge = await chargeConversationLimit(ctx.identityId, id, now);
  if (!charge.allowed) {
    return refusal(
      ctx,
      "rate_limited",
      `At most ${charge.limit} messages per conversation per hour. Try again in ${charge.retryAfterSec} seconds.`,
      429,
      [id],
    );
  }

  const sent = await dispatch(ctx, id, () => sendText({ to: convo.contactPhone, body: input.text }));
  if ("failed" in sent) return sent.failed;

  const message = await mirror(id, {
    conversationId: id,
    direction: "outbound",
    type: "text",
    body: input.text,
    waMessageId: sent.waMessageId || null,
    status: "sent",
    sentByUserId: ctx.userId,
  });
  return {
    body: sentBody(ctx, message, sent.waMessageId, reference),
    recordIds: message ? [id, message.id] : [id],
    fieldsChanged: ["message", "lastOutboundAt"],
  };
};

// ---- templates -------------------------------------------------------------

type TemplateRequest = { conversationId: string; templateId: string; variables: string[] };

async function sendTemplateCore(tool: TemplateTool, ctx: AgentContext, req: TemplateRequest): Promise<AgentHandlerResult> {
  const id = req.conversationId;
  const convo = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, contactPhone: true, lastInboundAt: true },
  });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");

  const now = Date.now();
  const elig = await loadEligibility(convo, now);
  if (elig.optedOut) return refusal(ctx, "opted_out", OPTED_OUT_MESSAGE, 403, [id]);

  const template = await prisma.template.findUnique({
    where: { id: req.templateId },
    select: { id: true, name: true, language: true, category: true, header: true, body: true, status: true, deletedAt: true },
  });
  if (!template || template.deletedAt) throw new AgentHttpError("not_found", "Template not found.");
  if (!isApprovedStatus(template.status)) {
    return refusal(ctx, "template_not_approved", "This template is not approved by WhatsApp, so it cannot be sent.", 422, [id]);
  }
  const route = routeTemplateCategory(tool, template.category);
  if (!route.ok) return refusal(ctx, route.code, route.message, 422, [id]);

  // Marketing needs recorded campaign consent as well as "not opted out".
  if (tool === "send_marketing_template" && !elig.canSendMarketingTemplate) {
    return refusal(
      ctx,
      "no_campaign_consent",
      "This contact has not given campaign consent (allowCampaign), so marketing templates cannot be sent.",
      403,
      [id],
    );
  }

  const check = validateVariables(template.body, req.variables);
  if (!check.ok) throw new AgentHttpError("invalid_input", check.message);

  // A UTILITY template is pre-approved text, but its variables are free text:
  // a price or a promise smuggled into one still goes to a human.
  if (tool === "send_template") {
    const guard = detectSensitiveContent(req.variables.join("\n"));
    if (guard.flagged) {
      return holdForApproval(
        ctx,
        tool,
        { conversationId: id, templateId: template.id, variables: req.variables },
        guard.categories,
        [id],
      );
    }
  }

  const rendered = renderTemplateText(template.body, req.variables);
  const recent = await prisma.message.findMany({
    where: {
      conversationId: id,
      direction: "outbound",
      templateId: template.id,
      createdAt: { gte: new Date(now - DEDUPE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: MESSAGE_SELECT,
  });
  const dup = findDuplicate(recent, rendered, now);
  if (dup) {
    return {
      body: {
        sent: false,
        duplicate: true,
        mirrored: true,
        waMessageId: null,
        reference: null,
        message: toMessageDto(dup, ctx.userId),
      },
      recordIds: [id, dup.id],
    };
  }

  const charge = await chargeConversationLimit(ctx.identityId, id, now);
  if (!charge.allowed) {
    return refusal(
      ctx,
      "rate_limited",
      `At most ${charge.limit} messages per conversation per hour. Try again in ${charge.retryAfterSec} seconds.`,
      429,
      [id],
    );
  }

  const components = buildTemplateComponents(template.header, template.body, req.variables);
  const sent = await dispatch(ctx, id, () =>
    sendTemplate({ to: convo.contactPhone, templateName: template.name, language: template.language, components }),
  );
  if ("failed" in sent) return sent.failed;

  const message = await mirror(id, {
    conversationId: id,
    direction: "outbound",
    type: "template",
    body: rendered,
    waMessageId: sent.waMessageId || null,
    templateId: template.id,
    status: "sent",
    sentByUserId: ctx.userId,
  });
  return {
    body: sentBody(ctx, message, sent.waMessageId, null),
    recordIds: message ? [id, template.id, message.id] : [id, template.id],
    fieldsChanged: ["message", "lastOutboundAt"],
  };
}

export const sendTemplateHandler: AgentHandler<z.infer<typeof sendTemplateBody>> = ({ ctx, input, params }) =>
  sendTemplateCore("send_template", ctx, {
    conversationId: parseId(params.id),
    templateId: input.templateId,
    variables: input.variables,
  });

/**
 * Normally unreachable: the tool's default verdict is APPROVAL, so withAgent
 * queues the request and never calls this. It exists so that once a human
 * approves, the same checks (opt-out, consent, approved template, variables)
 * run again at send time.
 */
export const sendMarketingTemplateHandler: AgentHandler<z.infer<typeof sendMarketingTemplateBody>> = ({
  ctx,
  input,
}) =>
  sendTemplateCore("send_marketing_template", ctx, {
    conversationId: parseId(input.conversationId),
    templateId: input.templateId,
    variables: input.variables,
  });
