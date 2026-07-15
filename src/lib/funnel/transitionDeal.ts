// The ONLY code path allowed to change Deal.currentStageId (per the build
// spec's §5.3 requirement). Generalizes the validation/transaction pattern
// already proven in src/app/api/conversations/[id]/stage/route.ts (won
// needs a value, lost needs a reason, $transaction, conditional history
// write) — extracted here so it isn't duplicated once /deals and the
// WhatsApp bot's `stage` command (Phase 5) both need to trigger transitions.
//
// Write-through: when a Deal has a conversationId, this also best-effort
// syncs Conversation.pipelineStage/dealValue/expectedCloseAt/lostReason so
// /pipeline and the current /team analytics keep working unchanged through
// Phase 1-2 (see docs/DECISIONS.md). The 13 new FunnelStage rows don't map
// 1:1 to the old 7-stage Conversation.pipelineStage system, so LEGACY_STAGE_MAP
// below is a deliberate many-to-one approximation, not a source of truth.

import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

// Maps each seeded FunnelStage slug -> the closest old 7-stage pipeline.ts
// slug, for the Conversation write-through only. See file header.
const LEGACY_STAGE_MAP: Record<string, string> = {
  enquiry_received: "new",
  contacted_qualified: "qualified",
  site_visit_scheduled: "qualified",
  site_visit_done: "qualified",
  sample_sent: "qualified",
  design_shared: "demo_scheduled",
  quotation_sent: "proposal_sent",
  proposal_sent: "proposal_sent",
  negotiation: "negotiation",
  verbal_confirmation: "negotiation",
  won_po_advance_received: "won",
  lost_rejected: "lost",
  dropped_cold: "lost",
};

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
  const enteringSiteVisitDone = isChanging && targetStage.slug === "site_visit_done" && !deal.siteVisitAt;
  const enteringSampleSent = isChanging && targetStage.slug === "sample_sent" && !deal.sampleSentAt;
  const enteringQuotationSent = isChanging && targetStage.slug === "quotation_sent" && !deal.firstQuotedAt;
  const enteringNegotiation = isChanging && targetStage.slug === "negotiation" && !deal.negotiationAt;
  const enteringClosed = isChanging && (targetStage.stageType === "won" || targetStage.stageType === "lost");

  const updated = await prisma.$transaction(async (tx) => {
    const d = await tx.deal.update({
      where: { id: input.dealId },
      data: {
        currentStageId: targetStage.id,
        wonValue: input.wonValue ?? deal.wonValue,
        lossReasonId: input.lossReasonId ?? deal.lossReasonId,
        lossReasonNote: input.lossReasonNote ?? deal.lossReasonNote,
        expectedCloseAt: input.expectedCloseAt !== undefined ? input.expectedCloseAt : deal.expectedCloseAt,
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

    // Best-effort legacy write-through — never fails the transition itself.
    if (deal.conversationId) {
      const legacySlug = LEGACY_STAGE_MAP[targetStage.slug] ?? null;
      if (legacySlug) {
        const convo = await tx.conversation.findUnique({ where: { id: deal.conversationId } });
        if (convo) {
          await tx.conversation.update({
            where: { id: deal.conversationId },
            data: {
              pipelineStage: legacySlug,
              stageChangedAt: convo.pipelineStage === legacySlug ? convo.stageChangedAt : now,
              dealValue: input.wonValue ?? d.estimatedValue ?? d.quotedValue ?? convo.dealValue,
              lostReason: input.lossReasonNote ?? convo.lostReason,
              expectedCloseAt: d.expectedCloseAt ?? convo.expectedCloseAt,
            },
          });
        }
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
