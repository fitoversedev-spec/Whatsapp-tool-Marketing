/**
 * Pure rules for handing an AI chat to a salesperson (no database here, so
 * they are easy to test). The flow:
 *
 *   a request is filed                                      status PENDING
 *     kind CUSTOMER_REQUEST  the customer asked the AI for a person. The AI may
 *                            send one holding reply, then only answers when the
 *                            customer writes again.
 *     kind SALES_REQUEST     a salesperson asked for a hot lead. The AI carries on.
 *   an admin assigns a salesperson                          status APPROVED
 *     (or assigns directly: kind ADMIN_ASSIGN)
 *     The salesperson contacts the customer from their own phone. The AI keeps
 *     answering product and technical questions on the business number and
 *     leaves price, quotes, discounts and visits to the salesperson.
 *   declined                                                status REJECTED
 *   lead released by the salesperson / an admin             status RELEASED
 */

export const HANDOFF_STATUSES = ["PENDING", "APPROVED", "REJECTED", "RELEASED"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const HANDOFF_KINDS = ["CUSTOMER_REQUEST", "SALES_REQUEST", "ADMIN_ASSIGN"] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

/** Statuses during which a request is open or a salesperson owns the lead. */
export const ACTIVE_HANDOFF_STATUSES: HandoffStatus[] = ["PENDING", "APPROVED"];

export type AiMode = "ai" | "waiting_for_human" | "sales_assigned";

export type AiModeDecision = {
  mode: AiMode;
  /** May the AI send a message in this chat right now? */
  canReply: boolean;
  /** Machine-readable why, for the agent. */
  reason:
    | "no_handoff"
    | "sales_requested"
    | "holding_reply_allowed"
    | "customer_wrote_again"
    | "waiting_for_customer"
    | "sales_assigned";
};

export function isHandoffStatus(v: unknown): v is HandoffStatus {
  return typeof v === "string" && (HANDOFF_STATUSES as readonly string[]).includes(v);
}

/**
 * `latestSinceRequest` is the newest message in the chat sent at or after the
 * handoff was requested (any sender), or null if there is none. It only matters
 * while a customer's own request is waiting for an admin.
 */
export function decideAiMode(
  handoff: { status: string; kind?: string | null } | null,
  latestSinceRequest: { direction: string } | null,
): AiModeDecision {
  if (!handoff || !(ACTIVE_HANDOFF_STATUSES as string[]).includes(handoff.status)) {
    return { mode: "ai", canReply: true, reason: "no_handoff" };
  }
  if (handoff.status === "APPROVED") return { mode: "sales_assigned", canReply: true, reason: "sales_assigned" };
  // PENDING
  if (handoff.kind && handoff.kind !== "CUSTOMER_REQUEST") return { mode: "ai", canReply: true, reason: "sales_requested" };
  if (!latestSinceRequest) return { mode: "waiting_for_human", canReply: true, reason: "holding_reply_allowed" };
  if (latestSinceRequest.direction === "inbound") {
    return { mode: "waiting_for_human", canReply: true, reason: "customer_wrote_again" };
  }
  return { mode: "waiting_for_human", canReply: false, reason: "waiting_for_customer" };
}

export const WAITING_FOR_CUSTOMER_MESSAGE =
  "The customer asked for a person and an admin has not assigned one yet. You may only reply after the customer writes again.";

/** What the AI should do in a chat that has a salesperson. */
export function salesAssignedGuidance(rep: { name: string; phone: string | null }): string {
  const who = rep.phone ? `${rep.name} (${rep.phone})` : rep.name;
  return (
    `Salesperson ${who} owns this lead and contacts the customer from their own phone. ` +
    "Keep answering product and technical questions. For price, quotations, discounts, site visits " +
    `or scheduling, say ${rep.name} will handle it — do not negotiate or commit.`
  );
}

/** The message the AI sends the customer when a salesperson is assigned. */
export function introText(customerName: string | null, rep: { name: string; phone: string | null }): string {
  const first = customerName?.trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first}! ` : "Hi! ";
  const contact = rep.phone ? `will contact you from ${rep.phone}` : "will contact you shortly";
  return `${hi}${rep.name} from the Fitoverse sales team ${contact} to take this forward. I'm still here for any product or technical questions.`;
}
