import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({
    where: { id: params.id },
    include: {
      account: { include: { contacts: true, customerProfile: true, cityTier: true } },
      primaryContact: true,
      owner: { select: { id: true, name: true } },
      office: true,
      currentStage: true,
      leadSource: true,
      lossReason: true,
      lineItems: true,
      stageHistory: { orderBy: { changedAt: "desc" }, include: { fromStage: true, toStage: true, changedBy: { select: { name: true } } } },
    },
  });
  if (!deal || deal.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ deal });
}

// General field edits — NOT stage (that's transitionDeal via
// [id]/stage/route.ts, the only path allowed to touch currentStageId).
//
// customerProfileId/businessType are Account fields, not Deal fields — a
// deal has no columns for them directly (see prisma/schema.prisma's
// Account model) — but they're accepted here too so the Deal Detail page
// has one edit action for "everything about this deal and its customer,"
// rather than sending sales to a separate Account-editing screen that
// doesn't exist. Same permission rule as everything else in this schema:
// admin, or the deal's own owner.
const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  officeId: z.string().uuid().nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  leadSourceId: z.string().uuid().nullable().optional(),
  customerProfileId: z.string().uuid().nullable().optional(),
  businessType: z.enum(["B2B", "B2C", "B2G"]).nullable().optional(),
  // Account.name/city/ownerUserId — prefixed "account" to disambiguate
  // from this same schema's Deal-level `title`/`ownerUserId`. Closes the
  // only remaining gap in "this page edits everything about a deal and
  // its customer": name/city could be set once at Account creation and
  // never corrected — no /api/accounts route exists at all. See
  // docs/DECISIONS.md.
  accountName: z.string().min(1).max(200).optional(),
  accountCity: z.string().max(100).nullable().optional(),
  accountOwnerUserId: z.string().uuid().nullable().optional(),
  siteCity: z.string().max(100).nullable().optional(),
  siteCityTierId: z.string().uuid().nullable().optional(),
  siteState: z.string().max(100).nullable().optional(),
  siteAddress: z.string().max(500).nullable().optional(),
  estimatedValue: z.number().min(0).max(999999999).nullable().optional(),
  quotedValue: z.number().min(0).max(999999999).nullable().optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  deleted: z.boolean().optional(),
  // Post-won delivery tracking (Deal.executionStatus/executionStartedAt/
  // deliveryCompletedAt — analytics v2 Phase 4's execution.ts reads these).
  // Timestamps are stamped server-side below, never trusted from the
  // client, same "set once, never overwritten on re-entry" discipline
  // transitionDeal.ts uses for firstContactAt/siteVisitAt/etc.
  executionStatus: z.enum(["IN_EXECUTION", "COMPLETED"]).optional(),
  // Manually-typed next step + its date, edited on the contact/deal page
  // (Zoho-style "next action"). Free text, no ActivityType involved.
  nextActionNote: z.string().max(500).nullable().optional(),
  nextActionDueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deal = await prisma.deal.findUnique({ where: { id: params.id } });
  if (!deal || deal.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && deal.ownerUserId && deal.ownerUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // Reassigning the owner is admin-only — same rule as reassigning a
  // Conversation (PATCH /api/conversations/[id]/route.ts). A sales rep can
  // edit everything else about their own deal, but handing it to someone
  // else isn't theirs to decide unilaterally. Same rule for the Account's
  // owner and for deleting the deal outright — both are more consequential
  // than the fields a deal's own owner is trusted to self-edit.
  if (parsed.data.ownerUserId !== undefined && !isAdmin(user.role)) {
    return NextResponse.json({ error: "Only admin can reassign a deal's owner" }, { status: 403 });
  }
  if (parsed.data.accountOwnerUserId !== undefined && !isAdmin(user.role)) {
    return NextResponse.json({ error: "Only admin can reassign an account's owner" }, { status: 403 });
  }
  if (parsed.data.deleted && !isAdmin(user.role)) {
    return NextResponse.json({ error: "Only admin can delete a deal" }, { status: 403 });
  }
  if (parsed.data.executionStatus !== undefined && deal.outcome !== "WON") {
    return NextResponse.json({ error: "Execution status can only be set on a WON deal" }, { status: 422 });
  }
  if (parsed.data.ownerUserId) {
    const target = await prisma.user.findUnique({ where: { id: parsed.data.ownerUserId } });
    if (!target || target.deletedAt || !target.isActive || target.approvalStatus !== "approved") {
      return NextResponse.json({ error: "Target user is not available" }, { status: 422 });
    }
  }
  if (parsed.data.accountOwnerUserId) {
    const target = await prisma.user.findUnique({ where: { id: parsed.data.accountOwnerUserId } });
    if (!target || target.deletedAt || !target.isActive || target.approvalStatus !== "approved") {
      return NextResponse.json({ error: "Target user is not available" }, { status: 422 });
    }
  }

  const { deleted, expectedCloseAt, customerProfileId, businessType, accountName, accountCity, accountOwnerUserId, executionStatus, nextActionDueAt, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };
  if (expectedCloseAt !== undefined) patch.expectedCloseAt = expectedCloseAt ? new Date(expectedCloseAt) : null;
  if (nextActionDueAt !== undefined) patch.nextActionDueAt = nextActionDueAt ? new Date(nextActionDueAt) : null;
  if (deleted) patch.deletedAt = new Date();
  // Stamped server-side, set-once — a later re-click of the same button
  // (e.g. a double-submit) must not push executionStartedAt/
  // deliveryCompletedAt forward again.
  if (executionStatus !== undefined) {
    patch.executionStatus = executionStatus;
    if (executionStatus === "IN_EXECUTION" && !deal.executionStartedAt) patch.executionStartedAt = new Date();
    if (executionStatus === "COMPLETED") {
      patch.deliveryCompletedAt = new Date();
      if (!deal.executionStartedAt) patch.executionStartedAt = new Date();
    }
  }

  const updated = await prisma.deal.update({ where: { id: params.id }, data: patch });

  if (customerProfileId !== undefined || businessType !== undefined || accountName !== undefined || accountCity !== undefined || accountOwnerUserId !== undefined) {
    await prisma.account.update({
      where: { id: deal.accountId },
      data: {
        ...(customerProfileId !== undefined ? { customerProfileId } : {}),
        ...(businessType !== undefined ? { businessType } : {}),
        ...(accountName !== undefined ? { name: accountName } : {}),
        ...(accountCity !== undefined ? { city: accountCity } : {}),
        ...(accountOwnerUserId !== undefined ? { ownerUserId: accountOwnerUserId } : {}),
      },
    });
  }

  // Bridge to the linked Conversation — best-effort, never blocks this
  // response. Before this, editing a deal's owner/close-date/value here
  // never reached the Conversation side at all, leaving /pipeline and
  // ContactDetailDrawer showing stale data after a real edit. Mirrors
  // PATCH /api/conversations/[id]/route.ts's reverse-direction sync (Deal
  // reassignment -> Conversation.assignedToUserId) and transitionDeal.ts's
  // write-through (expectedCloseAt/dealValue), fixed to prefer the most
  // concrete figure available (won > quoted > estimated) rather than the
  // stale-estimate-first bug in that file — see docs/DECISIONS.md.
  if (deal.conversationId) {
    const convoPatch: Record<string, unknown> = {};
    if (parsed.data.ownerUserId !== undefined) convoPatch.assignedToUserId = parsed.data.ownerUserId;
    if (expectedCloseAt !== undefined) convoPatch.expectedCloseAt = patch.expectedCloseAt;
    if (parsed.data.estimatedValue !== undefined || parsed.data.quotedValue !== undefined) {
      convoPatch.dealValue = updated.wonValue ?? updated.quotedValue ?? updated.estimatedValue ?? null;
    }
    if (Object.keys(convoPatch).length > 0) {
      await prisma.conversation.update({ where: { id: deal.conversationId }, data: convoPatch }).catch(() => null);
    }
  }

  return NextResponse.json({ deal: updated });
}
