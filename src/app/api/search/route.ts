// Cross-entity full-text-ish search. Uses Prisma's `contains` with
// `mode: "insensitive"` which maps to Postgres ILIKE — fast enough for the
// expected dataset (~10K messages, ~1K contacts) and avoids a tsvector
// migration. Hits 4 tables in parallel: messages, notes, contacts, templates.
//
// Permissions:
//   - Sales: messages/notes only inside conversations they can see (assigned
//     or unassigned). Contacts + templates: all (read-only).
//   - Admin: everything.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PER_TYPE = 20;
const MAX_QUERY_LEN = 200;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!raw) {
    return NextResponse.json({
      query: "",
      messages: [],
      notes: [],
      contacts: [],
      templates: [],
    });
  }
  if (raw.length > MAX_QUERY_LEN) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }

  const ilike = { contains: raw, mode: "insensitive" as const };

  // Conversation scope filter for messages and notes — mirrors inbox.
  const convoScope =
    user.role === "admin"
      ? {}
      : { OR: [{ assignedToUserId: user.id }, { assignedToUserId: null }] };

  const [messagesRaw, notesRaw, contactsRaw, templatesRaw] = await Promise.all([
    prisma.message.findMany({
      where: {
        body: ilike,
        conversation: convoScope,
      },
      orderBy: { createdAt: "desc" },
      take: PER_TYPE,
      include: {
        conversation: {
          select: { id: true, contactPhone: true, contactName: true },
        },
      },
    }),
    prisma.conversationNote.findMany({
      where: {
        body: ilike,
        conversation: convoScope,
      },
      orderBy: { createdAt: "desc" },
      take: PER_TYPE,
      include: {
        conversation: {
          select: { id: true, contactPhone: true, contactName: true },
        },
        author: { select: { name: true } },
      },
    }),
    prisma.contact.findMany({
      where: {
        OR: [
          { name: ilike },
          { phone: { contains: raw } },
          { fields: { contains: raw, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: PER_TYPE,
    }),
    prisma.template.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: ilike },
          { body: ilike },
        ],
      },
      orderBy: { name: "asc" },
      take: PER_TYPE,
    }),
  ]);

  return NextResponse.json({
    query: raw,
    messages: messagesRaw.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      contactPhone: m.conversation.contactPhone,
      contactName: m.conversation.contactName,
      body: m.body ?? "",
      direction: m.direction,
      createdAt: m.createdAt.toISOString(),
    })),
    notes: notesRaw.map((n) => ({
      id: n.id,
      conversationId: n.conversationId,
      contactPhone: n.conversation.contactPhone,
      contactName: n.conversation.contactName,
      body: n.body,
      authorName: n.author.name,
      createdAt: n.createdAt.toISOString(),
    })),
    contacts: contactsRaw.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
    })),
    templates: templatesRaw.map((t) => ({
      id: t.id,
      name: t.name,
      bodySnippet: t.body.slice(0, 140),
      status: t.status,
      category: t.category,
    })),
  });
}
