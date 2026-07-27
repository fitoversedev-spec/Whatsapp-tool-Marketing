// Mark a thread read for the current user: zero their unread counter, stamp
// lastReadAt, and mark any of their unseen @mentions in this thread as seen.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/rbac";
import { loadThreadAuthorized, type ChatAnchorType } from "@/lib/chat/access";

export const runtime = "nodejs";

const ANCHOR_TYPES = ["account_contact", "deal", "team", "dm"] as const;
function parseAnchor(entityType: string): ChatAnchorType | null {
  return (ANCHOR_TYPES as readonly string[]).includes(entityType) ? (entityType as ChatAnchorType) : null;
}

export async function PATCH(_req: NextRequest, { params }: { params: { entityType: string; entityId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const anchor = parseAnchor(params.entityType);
  if (!anchor) return NextResponse.json({ error: "bad_entity_type" }, { status: 400 });

  const res = await loadThreadAuthorized(anchor, params.entityId, { id: user.id, role: user.role as Role });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const threadId = res.thread.id;
  const now = new Date();

  // Read cursor. Upsert covers the reader who has no row yet (e.g. an admin or
  // a reassigned owner opening the thread for the first time) — role ADMIN is
  // just a placeholder for that lazy row; visibility is still computed, never
  // read from this role.
  await prisma.chatParticipant.upsert({
    where: { threadId_userId: { threadId, userId: user.id } },
    create: {
      threadId,
      userId: user.id,
      role: res.owns ? "OWNER" : res.admin ? "ADMIN" : "TAGGED",
      lastReadAt: now,
      unreadCount: 0,
    },
    update: { lastReadAt: now, unreadCount: 0 },
  });

  // Mark this user's unseen mentions in this thread as seen. ChatMention has no
  // threadId column, so resolve the thread's message ids first (updateMany
  // can't filter across the message relation).
  const msgIds = (await prisma.chatMessage.findMany({ where: { threadId }, select: { id: true } })).map((m) => m.id);
  if (msgIds.length) {
    await prisma.chatMention.updateMany({
      where: { mentionedUserId: user.id, seenAt: null, messageId: { in: msgIds } },
      data: { seenAt: now },
    });
  }

  return NextResponse.json({ ok: true });
}
