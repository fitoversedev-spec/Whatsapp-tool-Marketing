/** Pure rules for "may the AI send this contact a message right now?". */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Same rule as the inbox composer: open only while the last inbound message is < 24 h old. */
export function isWindowOpen(lastInboundAt: Date | null | undefined, now: number): boolean {
  return !!lastInboundAt && now - lastInboundAt.getTime() < WINDOW_MS;
}

export type EligibilityReason = "opted_out" | "window_closed";

export type Eligibility = {
  canReplyFreeText: boolean;
  windowOpen: boolean;
  /** ISO time the 24 h window closes (or closed); null when the contact never messaged us. */
  windowEndsAt: string | null;
  optedOut: boolean;
  /** Contact.allowCampaign; null when there is no marketing Contact record (no consent on file). */
  allowCampaign: boolean | null;
  canSendUtilityTemplate: boolean;
  canSendMarketingTemplate: boolean;
  /** Why canReplyFreeText is false. Opt-out outranks the window. */
  reasonIfNot: EligibilityReason | null;
};

export function decideEligibility(args: {
  lastInboundAt: Date | null | undefined;
  now: number;
  optedOut: boolean;
  allowCampaign: boolean | null;
}): Eligibility {
  const windowOpen = isWindowOpen(args.lastInboundAt, args.now);
  const canReplyFreeText = windowOpen && !args.optedOut;
  return {
    canReplyFreeText,
    windowOpen,
    windowEndsAt: args.lastInboundAt ? new Date(args.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null,
    optedOut: args.optedOut,
    allowCampaign: args.allowCampaign,
    canSendUtilityTemplate: !args.optedOut,
    canSendMarketingTemplate: !args.optedOut && args.allowCampaign === true,
    reasonIfNot: canReplyFreeText ? null : args.optedOut ? "opted_out" : "window_closed",
  };
}
