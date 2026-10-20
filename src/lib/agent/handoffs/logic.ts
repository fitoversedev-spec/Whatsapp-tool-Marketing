/**
 * Pure rules for the AI → human handoff (no database here, so they are easy to
 * test). The flow:
 *
 *   customer asks for a person
 *     -> AI calls request_human_handoff            status PENDING
 *        AI may send one holding reply, then only answers when the customer
 *        writes again (it never starts talking on its own while waiting)
 *     -> approver picks a salesperson              status APPROVED
 *        AI is silent in that chat
 *     -> approver rejects                          status REJECTED  (AI carries on)
 *     -> salesperson / approver hands it back      status RELEASED  (AI carries on)
 */

export const HANDOFF_STATUSES = ["PENDING", "APPROVED", "REJECTED", "RELEASED"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

/** Statuses during which the AI is not fully in charge of the chat. */
export const ACTIVE_HANDOFF_STATUSES: HandoffStatus[] = ["PENDING", "APPROVED"];

export type AiMode = "ai" | "waiting_for_human" | "human";

export type AiModeDecision = {
  mode: AiMode;
  /** May the AI send a message in this chat right now? */
  canReply: boolean;
  /** Machine-readable why, for the agent. */
  reason: "no_handoff" | "holding_reply_allowed" | "customer_wrote_again" | "waiting_for_customer" | "human_assigned";
};

export function isHandoffStatus(v: unknown): v is HandoffStatus {
  return typeof v === "string" && (HANDOFF_STATUSES as readonly string[]).includes(v);
}

/**
 * `latestSinceRequest` is the newest message in the chat sent at or after the
 * handoff was requested (any sender), or null if there is none.
 *
 * While PENDING the AI may speak only when the customer spoke last: either no
 * one has written since the request (the one holding reply) or the newest
 * message is the customer's. Once the AI has replied it waits for the customer.
 */
export function decideAiMode(
  handoff: { status: string } | null,
  latestSinceRequest: { direction: string } | null,
): AiModeDecision {
  if (!handoff || !(ACTIVE_HANDOFF_STATUSES as string[]).includes(handoff.status)) {
    return { mode: "ai", canReply: true, reason: "no_handoff" };
  }
  if (handoff.status === "APPROVED") return { mode: "human", canReply: false, reason: "human_assigned" };
  if (!latestSinceRequest) return { mode: "waiting_for_human", canReply: true, reason: "holding_reply_allowed" };
  if (latestSinceRequest.direction === "inbound") {
    return { mode: "waiting_for_human", canReply: true, reason: "customer_wrote_again" };
  }
  return { mode: "waiting_for_human", canReply: false, reason: "waiting_for_customer" };
}

export const HANDOFF_REFUSAL_MESSAGE: Record<"waiting_for_customer" | "human_assigned", string> = {
  waiting_for_customer:
    "The customer asked for a human and an admin has not assigned one yet. You may only reply after the customer writes again.",
  human_assigned:
    "A salesperson has taken over this chat. The AI must not message this customer until the chat is handed back.",
};
