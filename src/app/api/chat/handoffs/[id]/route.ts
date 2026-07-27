// Act on a handoff request. Authorization is by the request's own roles (the
// recipient can accept/decline; an admin approves a takeover; the requester can
// cancel) — NOT loadThreadAuthorized, because the recipient may not yet have
// thread access (that's the whole point of accepting). Coverage completes on
// accept (grant + COVERING participant); takeover moves ownership on approval.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { postThreadNote } from "@/lib/chat/events";

export const runtime = "nodejs";

const actionSchema = z.object({ action: z.enum(["accept", "decline", "approve", "cancel"]) });

async function resolveThreadId(anchor: { accountContactId: string | null; dealId: string | null }, actorId: string): Promise<string> {
  const where = anchor.accountContactId ? { accountContactId: anchor.accountContactId } : { dealId: anchor.dealId };
  const existing = await prisma.chatThread.findFirst({ where, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.chatThread.create({ data: { ...where, createdByUserId: actorId }, select: { id: true } });
  return created.id;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = isAdmin(user.role);

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { action } = parsed.data;

  const hr = await prisma.handoffRequest.findUnique({
    where: { id: params.id },
    include: {
      accountContact: { select: { id: true, name: true, accountId: true } },
      deal: { select: { id: true, title: true, code: true } },
      fromUser: { select: { name: true } },
      toUser: { select: { id: true, name: true } },
    },
  });
  if (!hr) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const noun = hr.accountContactId ? "customer" : "deal";
  const anchor = { accountContactId: hr.accountContactId, dealId: hr.dealId };

  // ---- accept (recipient) ----
  if (action === "accept") {
    if (hr.toUserId !== user.id || hr.status !== "REQUESTED") {
      return NextResponse.json({ error: "not_actionable" }, { status: 403 });
    }
    const threadId = await resolveThreadId(anchor, user.id);
    if (hr.kind === "COVERAGE") {
      const expiresAt = hr.coverageEnd ?? new Date(Date.now() + 7 * 86400000);
      await prisma.$transaction([
        prisma.handoffRequest.update({ where: { id: hr.id }, data: { status: "COMPLETED" } }),
        prisma.coverageGrant.create({
          data: {
            userId: user.id,
            accountContactId: hr.accountContactId,
            dealId: hr.dealId,
            handoffRequestId: hr.id,
            startsAt: hr.coverageStart ?? new Date(),
            expiresAt,
          },
        }),
        prisma.chatParticipant.upsert({
          where: { threadId_userId: { threadId, userId: user.id } },
          create: { threadId, userId: user.id, role: "COVERING", addedByUserId: hr.fromUserId },
          update: { role: "COVERING" },
        }),
      ]);
      await postThreadNote(threadId, user.id, `✅ ${hr.toUser.name} is now covering this ${noun} until ${expiresAt.toLocaleDateString()}.`);
    } else {
      // TAKEOVER accepted → awaits admin approval.
      await prisma.handoffRequest.update({ where: { id: hr.id }, data: { status: "ACCEPTED" } });
      await postThreadNote(threadId, user.id, `👍 ${hr.toUser.name} accepted the takeover — awaiting admin approval.`);
    }
    return NextResponse.json({ ok: true });
  }

  // ---- decline (recipient while REQUESTED, or admin on a pending approval) ----
  if (action === "decline") {
    const canDecline = (hr.toUserId === user.id && hr.status === "REQUESTED") || (admin && hr.status === "ACCEPTED");
    if (!canDecline) return NextResponse.json({ error: "not_actionable" }, { status: 403 });
    await prisma.handoffRequest.update({ where: { id: hr.id }, data: { status: "DECLINED" } });
    const threadId = await resolveThreadId(anchor, user.id);
    await postThreadNote(threadId, user.id, `🚫 ${user.name} declined the ${hr.kind.toLowerCase()} request.`);
    return NextResponse.json({ ok: true });
  }

  // ---- approve (admin, takeover) → move ownership permanently ----
  if (action === "approve") {
    if (!admin || hr.kind !== "TAKEOVER" || hr.status !== "ACCEPTED") {
      return NextResponse.json({ error: "not_actionable" }, { status: 403 });
    }
    if (hr.dealId) {
      await prisma.deal.update({ where: { id: hr.dealId }, data: { ownerUserId: hr.toUserId } });
    } else if (hr.accountContact) {
      // Taking over a customer moves the whole account to the new rep.
      await prisma.account.update({ where: { id: hr.accountContact.accountId }, data: { ownerUserId: hr.toUserId } });
    }
    await prisma.handoffRequest.update({ where: { id: hr.id }, data: { status: "COMPLETED", approvedByUserId: user.id } });
    const threadId = await resolveThreadId(anchor, user.id);
    await postThreadNote(threadId, user.id, `🔑 ${user.name} approved the takeover — ${hr.toUser.name} now owns this ${noun}.`);
    return NextResponse.json({ ok: true });
  }

  // ---- cancel (requester) ----
  if (action === "cancel") {
    if (hr.fromUserId !== user.id || !["REQUESTED", "ACCEPTED"].includes(hr.status)) {
      return NextResponse.json({ error: "not_actionable" }, { status: 403 });
    }
    await prisma.handoffRequest.update({ where: { id: hr.id }, data: { status: "CANCELLED" } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
