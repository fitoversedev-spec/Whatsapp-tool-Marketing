import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import type { AgentContext } from "../context";
import { AgentHttpError } from "../errors";
import type { AgentHandlerResult } from "../withAgent";
import { requestApproval } from "../approvals";
import { NEEDS_APPROVAL_REASON, type GuardCategory } from "./contentGuard";
import { decideEligibility, type Eligibility } from "./eligibility";

/** Shared plumbing for the messaging handlers: ids, lookups, DTOs, refusals, approvals. */

export function parseId(raw: string | undefined): string {
  if (!raw || !/^[A-Za-z0-9_-]{1,64}$/.test(raw)) throw new AgentHttpError("invalid_input", "Invalid id.");
  return raw;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Every spelling of a stored phone number we might have recorded an opt-out or consent under. */
export function phoneCandidates(raw: string): string[] {
  return [...new Set([raw, normalizePhone(raw)].filter((p): p is string => !!p))];
}

/** Opt-out and campaign-consent state for one conversation, decided by the pure rules. */
export async function loadEligibility(
  convo: { contactPhone: string; lastInboundAt: Date | null },
  now: number = Date.now(),
): Promise<Eligibility> {
  const phones = phoneCandidates(convo.contactPhone);
  const [opt, contact] = await Promise.all([
    prisma.optOut.findFirst({ where: { phoneE164: { in: phones } }, select: { phoneE164: true } }),
    prisma.contact.findFirst({ where: { phone: { in: phones } }, select: { allowCampaign: true } }),
  ]);
  return decideEligibility({
    lastInboundAt: convo.lastInboundAt,
    now,
    optedOut: !!opt,
    allowCampaign: contact ? contact.allowCampaign : null,
  });
}

export const MESSAGE_SELECT = {
  id: true,
  direction: true,
  type: true,
  body: true,
  mediaMimeType: true,
  mediaFileName: true,
  status: true,
  createdAt: true,
  sentByUserId: true,
  templateId: true,
} as const;

export type MessageRow = {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  status: string;
  createdAt: Date;
  sentByUserId: string | null;
  templateId: string | null;
};

/** Who sent an outbound message. The AI's messages carry its service user as sender. */
export function senderOf(m: { direction: string; sentByUserId: string | null }, agentUserId: string) {
  if (m.direction !== "outbound") return null;
  if (!m.sentByUserId) return "system" as const;
  return m.sentByUserId === agentUserId ? ("ai_agent" as const) : ("staff" as const);
}

export function toMessageDto(m: MessageRow, agentUserId: string) {
  return {
    id: m.id,
    direction: m.direction === "outbound" ? ("outbound" as const) : ("inbound" as const),
    type: m.type,
    body: m.body,
    mediaMimeType: m.mediaMimeType,
    mediaFileName: m.mediaFileName,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    sentBy: senderOf(m, agentUserId),
    templateId: m.templateId,
  };
}

/**
 * A controlled refusal. Returned (not thrown) so the body can carry the
 * messaging-specific code (opted_out, window_closed, ...); the audit row's
 * `action` records `refused:<code>`. Like every 4xx, it is stored against the
 * Idempotency-Key, so a new attempt needs a new key.
 */
export function refusal(
  ctx: AgentContext,
  code: string,
  message: string,
  status: number,
  recordIds: string[] = [],
): AgentHandlerResult {
  return {
    status,
    body: { error: { code, message, correlationId: ctx.correlationId } },
    action: `refused:${code}`,
    recordIds,
  };
}

/**
 * Park a send that mentions a price, discount or promise for a human.
 * The stored input is the full request (conversation included) so the approver
 * sees exactly what would be sent.
 */
export async function holdForApproval(
  ctx: AgentContext,
  toolName: string,
  input: Record<string, unknown>,
  categories: GuardCategory[],
  recordIds: string[],
): Promise<AgentHandlerResult> {
  const { approvalId } = await requestApproval({
    identityId: ctx.identityId,
    correlationId: ctx.correlationId,
    toolName,
    input: { ...input, reason: NEEDS_APPROVAL_REASON, categories },
  });
  return {
    status: 202,
    body: { approvalId, status: "pending", reason: NEEDS_APPROVAL_REASON, categories },
    action: "approval_requested",
    recordIds: [...recordIds, approvalId],
  };
}
