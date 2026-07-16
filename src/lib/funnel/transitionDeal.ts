// The ONLY code path allowed to change Deal.currentStageId (per the build
// spec's §5.3 requirement). Generalizes the validation/transaction pattern
// already proven in src/app/api/conversations/[id]/stage/route.ts (won
// needs a value, lost needs a reason, $transaction, conditional history
// write) — extracted here so it isn't duplicated once /deals and the
// WhatsApp bot's `stage` command (Phase 5) both need to trigger transitions.
//
// Write-through: when a Deal has a conversationId, this also syncs
// Conversation.pipelineStage/dealValue/expectedCloseAt/lostReason so
// /pipeline keeps showing the right stage. /pipeline itself now reads its
// stage list directly from FunnelStage (src/lib/pipeline-server.ts) — the
// same 13 rows this file operates on — so this write-through is a direct
// same-slug sync, not a translation between two different vocabularies.
// (It used to be exactly that: a many-to-one approximation between this
// model's 13 stages and /pipeline's old, separate, hardcoded 7-stage
// system. See docs/DECISIONS.md for why that approximation is gone.)

import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { findOrCreateDealForConversation } from "@/lib/crm/deals";

export class TransitionDealError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type TransitionDealInput = {
  dealId: string;
  toStageId: string; // FunnelStage.id
  // null = system-driven transition (e.g. a future automated rule) — no
  // DealStageHistory row requires a real user, unlike the legacy
  // PipelineStageHistory.changedByUserId which is NOT NULL.
  userId: string | null;
  wonValue?: number | null;
  lossReasonId?: string | null;
  lossReasonNote?: string | null;
  expectedCloseAt?: Date | null;
  note?: string | null;
};

export async function transitionDeal(input: TransitionDealInput) {
  const deal = await prisma.deal.findUnique({ where: { id: input.dealId } });
  if (!deal) throw new TransitionDealError("not_found", "Deal not found");

  const targetStage = await prisma.funnelStage.findUnique({ where: { id: input.toStageId } });
  if (!targetStage || !targetStage.isActive) {
    throw new TransitionDealError("unknown_stage", `Unknown or inactive stage: ${input.toStageId}`);
  }

  const fromStageId = deal.currentStageId;
  const isChanging = fromStageId !== targetStage.id;

  // Won requires a value (incoming or already on the deal).
  if (targetStage.stageType === "won" && input.wonValue == null && deal.wonValue == null) {
    throw new TransitionDealError("won_value_required", "A won value is required to mark this deal won");
  }
  // Stages flagged requiresLossReason need a reason (id or free-text note).
  if (
    targetStage.requiresLossReason &&
    !input.lossReasonId &&
    !deal.lossReasonId &&
    !input.lossReasonNote?.trim() &&
    !deal.lossReasonNote?.trim()
  ) {
    throw new TransitionDealError("loss_reason_required", "A loss reason is required for this stage");
  }
  // Entering "Quotation Sent" requires >=1 SENT quotation on this deal
  // (spec §5.3) — Quotation.dealId only exists from Phase 2 onward, so this
  // guard is a no-op (passes trivially) for any deal whose quotes predate it.
  if (isChanging && targetStage.slug === "quotation_sent") {
    const sentQuote = await prisma.quotation.findFirst({
      where: { dealId: input.dealId, status: "sent" },
      select: { id: true },
    });
    if (!sentQuote) {
      throw new TransitionDealError(
        "quotation_required",
        "This deal needs at least one sent quotation before it can move to Quotation Sent — create and send one first.",
      );
    }
  }

  const now = new Date();
  const previousStageChangedAt = deal.updatedAt; // best-effort: no separate stageChangedAt on Deal today
  const durationInFromStageSeconds = isChanging
    ? Math.max(0, Math.round((now.getTime() - previousStageChangedAt.getTime()) / 1000))
    : null;

  // Side-effect timestamps — set-once (first time entering that state),
  // never overwritten on a later re-entry into the same stage. Built as
  // plain conditional spreads into ONE literal below (not a separately-typed
  // partial) so Prisma's relation-vs-scalar update-input union resolves
  // correctly — spreading a Prisma.DealUpdateInput built elsewhere confuses it.
  const enteringContactedQualified = isChanging && targetStage.slug === "contacted_qualified" && !deal.firstContactAt;
  const enteringSiteVisitDone = isChanging && targetStage.slug === "site_visit_done" && !deal.siteVisitAt;
  const enteringSampleSent = isChanging && targetStage.slug === "sample_sent" && !deal.sampleSentAt;
  const enteringQuotationSent = isChanging && targetStage.slug === "quotation_sent" && !deal.firstQuotedAt;
  const enteringNegotiation = isChanging && targetStage.slug === "negotiation" && !deal.negotiationAt;
  const enteringClosed = isChanging && (targetStage.stageType === "won" || targetStage.stageType === "lost");

  // Self-healing owner claim: every Deal-creation path already sets a
  // non-null ownerUserId, so a null owner here is always a historical
  // anomaly, not an intentional "unassigned" state — but until now nothing
  // ever corrected it, which made the deal permanently invisible to Team
  // Performance's per-rep filter even while its DealStageHistory correctly
  // showed a real rep actively moving it (confirmed against production: a
  // sales rep moved a null-owner deal through 4 real stage changes, all
  // correctly attributed in DealStageHistory, yet the deal never appeared
  // under their name in Team Performance — see docs/DECISIONS.md). Claiming
  // ownership for whoever is actually performing a real transition closes
  // that gap; a system-driven transition (input.userId === null) claims
  // nothing, since there's no real person to attribute it to.
  const claimsOwnership = isChanging && !deal.ownerUserId && !!input.userId;

  const updated = await prisma.$transaction(async (tx) => {
    const d = await tx.deal.update({
      where: { id: input.dealId },
      data: {
        currentStageId: targetStage.id,
        ...(claimsOwnership ? { ownerUserId: input.userId } : {}),
        wonValue: input.wonValue ?? deal.wonValue,
        // !== undefined, not ?? — an explicit null (clearing a loss reason)
        // must actually clear it. `??` would silently keep the old value
        // whenever a caller intentionally passed null, the same swallowed-
        // null bug expectedCloseAt below was already guarding against and
        // the Conversation write-through further down had too. See
        // docs/DECISIONS.md.
        lossReasonId: input.lossReasonId !== undefined ? input.lossReasonId : deal.lossReasonId,
        lossReasonNote: input.lossReasonNote !== undefined ? input.lossReasonNote : deal.lossReasonNote,
        expectedCloseAt: input.expectedCloseAt !== undefined ? input.expectedCloseAt : deal.expectedCloseAt,
        ...(enteringContactedQualified ? { firstContactAt: now } : {}),
        ...(enteringSiteVisitDone ? { siteVisitAt: now } : {}),
        ...(enteringSampleSent ? { sampleSentAt: now } : {}),
        ...(enteringQuotationSent ? { firstQuotedAt: now } : {}),
        ...(enteringNegotiation ? { negotiationAt: now } : {}),
        ...(enteringClosed
          ? { closedAt: deal.closedAt ?? now, outcome: targetStage.stageType === "won" ? "WON" : "LOST" }
          : {}),
      },
    });

    if (isChanging) {
      await tx.dealStageHistory.create({
        data: {
          dealId: input.dealId,
          fromStageId,
          toStageId: targetStage.id,
          changedByUserId: input.userId,
          durationInFromStageSeconds,
          note: input.note ?? null,
        },
      });
    }

    // Auto-suggest a follow-up reminder on entering "Quotation Sent" (spec
    // §9.1 example, offset not yet admin-configurable — see docs/DATA_GAPS.md
    // #11). Created outright rather than as a dismissible "suggestion" (no
    // separate suggestion UI exists) — the owner can delete it from
    // /reminders if unwanted. Skipped if the deal has no owner and this
    // wasn't a user-driven transition (nothing to assign it to).
    const reminderOwnerId = deal.ownerUserId ?? input.userId;
    if (isChanging && targetStage.slug === "quotation_sent" && reminderOwnerId) {
      await tx.reminder.create({
        data: {
          dealId: input.dealId,
          ownerUserId: reminderOwnerId,
          message: `Follow up on quotation for "${deal.title}"`,
          dueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      });
    }

    // Write-through to Conversation.pipelineStage — best-effort, never
    // fails the transition itself. Same slug on both sides now, so this is
    // a direct sync, not a lookup through an approximated mapping.
    if (deal.conversationId) {
      const convo = await tx.conversation.findUnique({ where: { id: deal.conversationId } });
      if (convo) {
        await tx.conversation.update({
          where: { id: deal.conversationId },
          data: {
            pipelineStage: targetStage.slug,
            stageChangedAt: convo.pipelineStage === targetStage.slug ? convo.stageChangedAt : now,
            // Most-concrete-figure-wins: an actual quoted amount is more
            // real than a pre-quote estimate, so quotedValue must win over
            // estimatedValue when both are set — this used to prefer the
            // stale estimate, which could regress /pipeline's displayed
            // value back to a rough guess even after a real quote existed.
            // See docs/DECISIONS.md.
            dealValue: input.wonValue ?? d.quotedValue ?? d.estimatedValue ?? convo.dealValue,
            // Direct mirror of the deal's own value, not `??` — d already
            // correctly resolved lossReasonNote/expectedCloseAt above
            // (explicit null clears them), so falling back to the
            // Conversation's OLD value here on a genuine null would
            // silently undo that clear. Safe on every transition, not just
            // ones that touch these fields: when a call doesn't pass them,
            // d.lossReasonNote/d.expectedCloseAt already just carry
            // forward the deal's existing persisted value unchanged, so
            // mirroring them never wipes something this call didn't touch.
            lostReason: d.lossReasonNote,
            expectedCloseAt: d.expectedCloseAt,
          },
        });
      }
    }

    return d;
  });

  if (isChanging) {
    await writeAudit({
      actorId: input.userId,
      entity: "Deal",
      entityId: input.dealId,
      action: "STAGE_CHANGE",
      diff: { fromStageId, toStageId: targetStage.id, wonValue: input.wonValue, lossReasonId: input.lossReasonId },
    });
  }

  return updated;
}

// Bridge from a /pipeline board move to a Deal transition. Called from
// api/conversations/[id]/stage/route.ts after its own Conversation-side
// transaction already succeeded. /pipeline's stage slug and FunnelStage's
// slug are the same value now (both read the same 13 rows), so this is a
// direct lookup — no translation, no ambiguity. Still best-effort/never
// throws: a sync failure here must never break the pipeline board's own
// response.
export async function syncDealFromPipelineStageChange(args: {
  conversationId: string;
  stageSlug: string;
  userId: string;
  accountNameFallback: string;
  wonValue?: number | null;
  lossReasonId?: string | null;
  lossReasonNote?: string | null;
  expectedCloseAt?: Date | null;
}): Promise<void> {
  try {
    const targetStage = await prisma.funnelStage.findUnique({ where: { slug: args.stageSlug } });
    if (!targetStage || !targetStage.isActive) return;

    const { id: dealId } = await findOrCreateDealForConversation({
      conversationId: args.conversationId,
      accountName: args.accountNameFallback,
      dealTitle: args.accountNameFallback,
      ownerUserId: args.userId,
    });

    await transitionDeal({
      dealId,
      toStageId: targetStage.id,
      userId: args.userId,
      wonValue: args.wonValue,
      lossReasonId: args.lossReasonId,
      lossReasonNote: args.lossReasonNote,
      expectedCloseAt: args.expectedCloseAt,
      note: "Synced from /pipeline stage change",
    });
  } catch (err) {
    console.error("[pipeline-sync] failed to sync Deal from Conversation stage change", err);
  }
}

// Best-effort, forward-only stage advance for real send actions — a quote
// or court design actually going out to the customer is a genuine progress
// signal and should move the deal (spec's own "Quotation Sent" guard
// already requires a real sent quotation to exist before a deal can enter
// that stage — this is what actually satisfies it going forward). Never
// regresses: a revised quote resent after the deal has already reached
// Negotiation must not drag it back down to Quotation Sent. Never throws —
// the send itself already succeeded by the time this runs and that must
// not be undone by a stage-advance failure.
export async function advanceDealStageIfEarlier(args: {
  dealId: string;
  targetStageSlug: string;
  userId: string;
  note?: string;
}): Promise<void> {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: args.dealId },
      select: { currentStage: { select: { sortOrder: true } } },
    });
    const targetStage = await prisma.funnelStage.findUnique({ where: { slug: args.targetStageSlug } });
    if (!deal || !targetStage || !targetStage.isActive) return;
    if (deal.currentStage.sortOrder >= targetStage.sortOrder) return; // already at or past this stage

    await transitionDeal({
      dealId: args.dealId,
      toStageId: targetStage.id,
      userId: args.userId,
      note: args.note,
    });
  } catch (err) {
    console.error("[advance-deal-stage] failed to advance deal on send", err);
  }
}
