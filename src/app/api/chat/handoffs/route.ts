// Create + list handoff requests (coverage / takeover). Creating one requires
// access to the anchored record (loadThreadAuthorized) and posts an in-thread
// note so the ask is logged where the team is talking.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin, type Role } from "@/lib/rbac";
import { loadThreadAuthorized, type ChatAnchorType } from "@/lib/chat/access";
import { postThreadNote } from "@/lib/chat/events";

export const runtime = "nodejs";

const createSchema = z
  .object({
    kind: z.enum(["COVERAGE", "TAKEOVER"]),
    entityType: z.enum(["account_contact", "deal"]),
    entityId: z.string().min(1),
    toUserId: z.string().uuid(),
    note: z.string().max(1000).optional(),
    coverageStart: z.string().datetime().optional(),
    coverageEnd: z.string().datetime().optional(),
  })
  .refine((d) => d.kind !== "COVERAGE" || !!d.coverageEnd, { message: "Coverage needs an end date" });

function anchorLabel(row: { accountContact: { name: string } | null; deal: { title: string; code: string } | null }): string {
  return row.accountContact ? row.accountContact.name : row.deal ? row.deal.title || row.deal.code : "record";
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const d = parsed.data;
  if (d.toUserId === user.id) return NextResponse.json({ error: "cannot_hand_off_to_self" }, { status: 400 });

  // The requester must be able to see the record they're handing off.
  const res = await loadThreadAuthorized(d.entityType as ChatAnchorType, d.entityId, { id: user.id, role: user.role as Role });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const toUser = await prisma.user.findFirst({
    where: { id: d.toUserId, deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (!toUser) return NextResponse.json({ error: "recipient_not_found" }, { status: 404 });

  const anchorWhere = d.entityType === "account_contact" ? { accountContactId: d.entityId } : { dealId: d.entityId };
  const request = await prisma.handoffRequest.create({
    data: {
      kind: d.kind,
      ...anchorWhere,
      fromUserId: user.id,
      toUserId: d.toUserId,
      note: d.note ?? null,
      coverageStart: d.coverageStart ? new Date(d.coverageStart) : d.kind === "COVERAGE" ? new Date() : null,
      coverageEnd: d.coverageEnd ? new Date(d.coverageEnd) : null,
    },
    select: { id: true },
  });

  const verb = d.kind === "COVERAGE" ? "cover" : "take over";
  const noun = d.entityType === "account_contact" ? "customer" : "deal";
  const until = d.coverageEnd ? ` until ${new Date(d.coverageEnd).toLocaleDateString()}` : "";
  await postThreadNote(
    res.thread.id,
    user.id,
    `🤝 ${user.name} asked ${toUser.name} to ${verb} this ${noun}${until}.${d.note ? ` Note: ${d.note}` : ""}`,
  );

  return NextResponse.json({ id: request.id });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = isAdmin(user.role);

  const rows = await prisma.handoffRequest.findMany({
    where: {
      OR: [
        { toUserId: user.id, status: "REQUESTED" },
        { fromUserId: user.id, status: { in: ["REQUESTED", "ACCEPTED"] } },
        ...(admin ? [{ kind: "TAKEOVER", status: "ACCEPTED" }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      accountContact: { select: { name: true } },
      deal: { select: { title: true, code: true } },
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
    },
  });

  const items = rows.map((r) => {
    const canRespond = r.toUserId === user.id && r.status === "REQUESTED";
    const canApprove = admin && r.kind === "TAKEOVER" && r.status === "ACCEPTED";
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      entityType: r.accountContactId ? ("account_contact" as const) : ("deal" as const),
      entityId: r.accountContactId ?? r.dealId!,
      label: anchorLabel(r),
      fromName: r.fromUser.name,
      toName: r.toUser.name,
      note: r.note,
      coverageEnd: r.coverageEnd ? r.coverageEnd.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      canRespond,
      canApprove,
      mine: r.fromUserId === user.id,
    };
  });

  return NextResponse.json({ requests: items });
}
