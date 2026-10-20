/**
 * The AI Sales Agent's side of the human handoff: ask for a person
 * (request_human_handoff), check whether it may speak (get_ai_status), and the
 * send-time gate that the messaging tools call so the rule holds even if the
 * agent forgets to check.
 *
 * Approving, rejecting and handing back live in ./admin.ts (human side).
 */
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { logContactEvent } from "@/lib/crm/contactEvents";
import { AGENT_ROLE_NAME, loadApproverConfig } from "../approvals";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import { parseId, phoneCandidates, refusal } from "../messaging/access";
import type { AgentHandler, AgentHandlerResult } from "../withAgent";
import type * as S from "../schemas/handoffs";
import { ACTIVE_HANDOFF_STATUSES, decideAiMode, HANDOFF_REFUSAL_MESSAGE, type AiModeDecision } from "./logic";

export type HandoffRow = {
  id: string;
  conversationId: string;
  accountContactId: string | null;
  status: string;
  reason: string;
  summary: string;
  requestedAt: Date;
  decidedAt: Date | null;
  assignedToUserId: string | null;
};

const HANDOFF_SELECT = {
  id: true,
  conversationId: true,
  accountContactId: true,
  status: true,
  reason: true,
  summary: true,
  requestedAt: true,
  decidedAt: true,
  assignedToUserId: true,
} as const;

/** The PENDING or APPROVED handoff on a chat, if any (newest wins). */
export async function findActiveHandoff(conversationId: string): Promise<HandoffRow | null> {
  return prisma.aiHumanHandoff.findFirst({
    where: { conversationId, status: { in: ACTIVE_HANDOFF_STATUSES } },
    orderBy: { requestedAt: "desc" },
    select: HANDOFF_SELECT,
  });
}

export async function loadAiMode(conversationId: string): Promise<{ handoff: HandoffRow | null; ai: AiModeDecision }> {
  const handoff = await findActiveHandoff(conversationId);
  const latest =
    handoff?.status === "PENDING"
      ? await prisma.message.findFirst({
          where: { conversationId, createdAt: { gte: handoff.requestedAt } },
          orderBy: { createdAt: "desc" },
          select: { direction: true },
        })
      : null;
  return { handoff, ai: decideAiMode(handoff, latest) };
}

/**
 * Called by send_reply / send_template / send_marketing_template before they
 * send. Null means "go ahead"; otherwise a 409 refusal to return as-is. A chat
 * with no handoff costs one indexed lookup and behaves exactly as before.
 */
export async function handoffGate(ctx: AgentContext, conversationId: string): Promise<AgentHandlerResult | null> {
  const { ai } = await loadAiMode(conversationId);
  if (ai.canReply) return null;
  const code = ai.reason === "human_assigned" ? "human_assigned" : "waiting_for_customer";
  return refusal(ctx, code, HANDOFF_REFUSAL_MESSAGE[code], 409, [conversationId]);
}

async function toDto(row: HandoffRow) {
  const assignee = row.assignedToUserId
    ? await prisma.user.findUnique({ where: { id: row.assignedToUserId }, select: { id: true, name: true } })
    : null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    leadId: row.accountContactId,
    status: row.status as "PENDING" | "APPROVED" | "REJECTED" | "RELEASED",
    reason: row.reason,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    assignedTo: assignee ? { userId: assignee.id, name: assignee.name } : null,
  };
}

/** The CRM lead for this chat: the one the agent named, else the contact linked to the same phone. */
async function resolveLeadId(contactPhone: string, leadId: string | undefined): Promise<string | null> {
  if (leadId) {
    const lead = await prisma.accountContact.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true } });
    if (!lead) throw new AgentHttpError("not_found", "Lead not found.");
    return lead.id;
  }
  const contact = await prisma.contact.findFirst({
    where: { phone: { in: phoneCandidates(contactPhone) }, accountContactId: { not: null } },
    select: { accountContactId: true },
  });
  if (contact?.accountContactId) return contact.accountContactId;
  const crm = await prisma.accountContact.findFirst({
    where: { phone: { in: phoneCandidates(contactPhone) }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return crm?.id ?? null;
}

/** Everyone who may decide AI requests, with push turned on. Best effort. */
async function notifyApprovers(payload: { title: string; body: string; url: string; tag: string }) {
  try {
    const cfg = await loadApproverConfig();
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        pushEnabled: true,
        role: { not: AGENT_ROLE_NAME },
        OR: [{ role: { in: cfg.roles } }, { id: { in: cfg.userIds } }],
      },
      select: { id: true },
    });
    await Promise.allSettled(users.map((u) => sendPushToUser(u.id, payload)));
  } catch {
    // The request is saved and shows on the handoffs screen either way.
  }
}

// ---- request_human_handoff -------------------------------------------------

export const requestHumanHandoff: AgentHandler<z.infer<typeof S.requestHumanHandoffInputSchema>> = async ({ ctx, input }) => {
  const conversationId = parseId(input.conversationId);
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, contactPhone: true, contactName: true },
  });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");

  // Asking twice while a request is open returns the open one.
  const open = await findActiveHandoff(conversationId);
  if (open) {
    const { ai } = await loadAiMode(conversationId);
    return {
      body: { requested: true, deduplicated: true, handoff: await toDto(open), ai },
      action: "dedupe:create",
      recordIds: [conversationId, open.id],
    };
  }

  const leadId = await resolveLeadId(convo.contactPhone, input.leadId);
  const row = await prisma.aiHumanHandoff.create({
    data: {
      conversationId,
      accountContactId: leadId,
      identityId: ctx.identityId,
      reason: input.reason,
      summary: input.summary ?? "",
      status: "PENDING",
    },
    select: HANDOFF_SELECT,
  });

  const who = convo.contactName?.trim() || "A customer";
  if (leadId) {
    await logContactEvent({
      contactId: leadId,
      actorUserId: ctx.userId,
      kind: "escalated",
      summary: "Customer asked for a human — waiting for admin to assign a salesperson",
      detail: `Reason: ${input.reason}${input.summary ? `\n\n${input.summary}` : ""}`,
      refId: row.id,
    });
  }
  await notifyApprovers({
    title: "Customer wants to talk to a person",
    body: `${who}: ${input.reason}`.slice(0, 140),
    url: "/crm/ai-handoffs",
    tag: `ai-handoff-${row.id}`,
  });

  const { ai } = await loadAiMode(conversationId);
  return {
    status: 201,
    body: { requested: true, deduplicated: false, handoff: await toDto(row), ai },
    recordIds: leadId ? [conversationId, row.id, leadId] : [conversationId, row.id],
  };
};

// ---- get_ai_status ---------------------------------------------------------

export const getAiStatus: AgentHandler<unknown> = async ({ params }) => {
  const conversationId = parseId(params.id);
  const convo = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
  if (!convo) throw new AgentHttpError("not_found", "Conversation not found.");
  const { handoff, ai } = await loadAiMode(conversationId);
  return {
    body: { conversationId, ai, handoff: handoff ? await toDto(handoff) : null },
    recordIds: handoff ? [conversationId, handoff.id] : [conversationId],
  };
};
