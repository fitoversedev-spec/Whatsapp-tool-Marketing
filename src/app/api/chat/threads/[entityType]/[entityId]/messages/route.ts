// List + post messages in a customer/deal team-chat thread. Every request goes
// through loadThreadAuthorized first (Option-B access gate). Posting a message
// runs in one transaction: create the message + its attachments + mentions,
// grant @-mentioned teammates access (a TAGGED participant row), bump everyone
// else's unread counter, and reset the author's own.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/rbac";
import { loadThreadAuthorized, type ChatAnchorType } from "@/lib/chat/access";
import { extractMentions } from "@/lib/chat/tokens";

export const runtime = "nodejs";

const ANCHOR_TYPES = ["account_contact", "deal", "team", "dm"] as const;

function parseAnchor(entityType: string): ChatAnchorType | null {
  return (ANCHOR_TYPES as readonly string[]).includes(entityType) ? (entityType as ChatAnchorType) : null;
}

const attachmentRef = z.object({
  fileName: z.string().min(1).max(400),
  fileUrl: z.string().url(),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().max(200),
  category: z.string().max(20).optional(),
});

const postSchema = z
  .object({
    body: z.string().max(4000).optional(),
    attachments: z.array(attachmentRef).max(10).optional(),
  })
  .refine((d) => (d.body && d.body.trim().length > 0) || (d.attachments && d.attachments.length > 0), {
    message: "Message must have text or at least one attachment",
  });

export async function GET(req: NextRequest, { params }: { params: { entityType: string; entityId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const anchor = parseAnchor(params.entityType);
  if (!anchor) return NextResponse.json({ error: "bad_entity_type" }, { status: 400 });

  const res = await loadThreadAuthorized(anchor, params.entityId, { id: user.id, role: user.role as Role });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const before = req.nextUrl.searchParams.get("before");
  const rows = await prisma.chatMessage.findMany({
    where: {
      threadId: res.thread.id,
      deletedAt: null,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      author: { select: { id: true, name: true } },
      attachments: true,
      mentions: true,
    },
  });

  return NextResponse.json({
    threadId: res.thread.id,
    messages: rows.reverse().map((m) => ({
      id: m.id,
      authorId: m.authorUserId,
      authorName: m.author.name,
      mine: m.authorUserId === user.id,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      attachments: m.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        fileUrl: a.fileUrl,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        category: a.category,
      })),
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { entityType: string; entityId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const anchor = parseAnchor(params.entityType);
  if (!anchor) return NextResponse.json({ error: "bad_entity_type" }, { status: 400 });

  const res = await loadThreadAuthorized(anchor, params.entityId, { id: user.id, role: user.role as Role });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { body, attachments } = parsed.data;
  const threadId = res.thread.id;

  // Mentions parsed from the body tokens. Person mentions must resolve to real
  // active users (bad ids would break the FK) and grant thread access; record
  // chips are free-form deep-link refs (no FK, no access grant).
  const { userIds, records } = extractMentions(body ?? "");
  const validUsers = userIds.length
    ? (await prisma.user.findMany({ where: { id: { in: userIds }, deletedAt: null, isActive: true }, select: { id: true } })).map((u) => u.id)
    : [];
  const mentionedOthers = validUsers.filter((id) => id !== user.id);
  const authorRole = res.owns ? "OWNER" : res.admin ? "ADMIN" : "TAGGED";

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.chatMessage.create({
      data: {
        threadId,
        authorUserId: user.id,
        body: body?.trim() || null,
        attachments: attachments?.length
          ? {
              create: attachments.map((a) => ({
                uploadedByUserId: user.id,
                fileName: a.fileName,
                fileUrl: a.fileUrl,
                fileSize: a.fileSize,
                mimeType: a.mimeType,
                category: a.category ?? "other",
              })),
            }
          : undefined,
        mentions: {
          create: [
            ...validUsers.map((id) => ({ mentionedUserId: id })),
            ...records.map((r) => ({ refType: r.refType, refId: r.id })),
          ],
        },
      },
      select: { id: true, createdAt: true },
    });

    // Grant every @-mentioned teammate access (TAGGED participant). No-op on
    // role if they already participate (owner/covering keeps its role).
    for (const id of mentionedOthers) {
      await tx.chatParticipant.upsert({
        where: { threadId_userId: { threadId, userId: id } },
        create: { threadId, userId: id, role: "TAGGED", addedByUserId: user.id },
        update: {},
      });
    }

    // Ensure the author has a read-cursor row.
    await tx.chatParticipant.upsert({
      where: { threadId_userId: { threadId, userId: user.id } },
      create: { threadId, userId: user.id, role: authorRole, lastReadAt: new Date(), unreadCount: 0 },
      update: { lastReadAt: new Date(), unreadCount: 0 },
    });

    // Everyone but the author gets +1 unread (covers existing participants and
    // the just-added mentioned users).
    await tx.chatParticipant.updateMany({
      where: { threadId, userId: { not: user.id } },
      data: { unreadCount: { increment: 1 } },
    });

    await tx.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: msg.createdAt } });
    return msg;
  });

  return NextResponse.json({ id: message.id, createdAt: message.createdAt.toISOString(), threadId });
}
