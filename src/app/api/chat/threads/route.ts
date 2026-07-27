// The launcher inbox. Always presents, at all times: the Team channel (pinned)
// and every teammate as a direct-message row (so you can DM anyone without
// hunting) — plus the customer/deal threads the user participates in. Unread
// counts on the Team/DM rows come from the user's participant row when one
// exists (0 otherwise). This list is "your chats"; admins still open any
// record's thread from the ✎ picker.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Item = {
  threadId: string;
  entityType: "account_contact" | "deal" | "team" | "dm";
  entityId: string;
  label: string;
  sublabel: string;
  unreadCount: number;
  lastMessageAt: string | null;
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [rows, teammates] = await Promise.all([
    prisma.chatParticipant.findMany({
      where: { userId: user.id },
      select: {
        unreadCount: true,
        thread: {
          select: {
            id: true,
            kind: true,
            lastMessageAt: true,
            accountContact: { select: { id: true, name: true } },
            deal: { select: { id: true, code: true, title: true } },
            participants: { where: { userId: { not: user.id } }, select: { user: { select: { id: true, name: true } } }, take: 1 },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { deletedAt: null, isActive: true, approvalStatus: "approved", id: { not: user.id } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Chat is a team messenger: the Team channel + 1:1 DMs with reps. Customers
  // and deals are referenced by @-tagging inside those chats, not as their own
  // threads — so record-anchored threads are intentionally NOT listed here.
  let teamUnread = 0;
  const dmByUser = new Map<string, { threadId: string; unreadCount: number; lastMessageAt: string | null }>();
  for (const r of rows) {
    const t = r.thread;
    const lastMessageAt = t.lastMessageAt ? t.lastMessageAt.toISOString() : null;
    if (t.kind === "team") {
      teamUnread = r.unreadCount;
    } else if (t.kind === "dm") {
      const other = t.participants[0]?.user;
      if (other) dmByUser.set(other.id, { threadId: t.id, unreadCount: r.unreadCount, lastMessageAt });
    }
  }

  // Every teammate is always a DM row, with unread merged from an existing
  // thread if there is one.
  const dms: Item[] = teammates.map((tm) => {
    const ex = dmByUser.get(tm.id);
    return {
      threadId: ex?.threadId ?? `dm:${tm.id}`,
      entityType: "dm",
      entityId: tm.id,
      label: tm.name,
      sublabel: "Direct message",
      unreadCount: ex?.unreadCount ?? 0,
      lastMessageAt: ex?.lastMessageAt ?? null,
    };
  });

  // Active chats first (by recency); never-used DMs fall to the bottom, alpha.
  const combined = [...dms].sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.localeCompare(a.lastMessageAt);
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.label.localeCompare(b.label);
  });

  const teamItem: Item = {
    threadId: "team",
    entityType: "team",
    entityId: "main",
    label: "Team channel",
    sublabel: "Everyone",
    unreadCount: teamUnread,
    lastMessageAt: null,
  };

  return NextResponse.json({ threads: [teamItem, ...combined] });
}
