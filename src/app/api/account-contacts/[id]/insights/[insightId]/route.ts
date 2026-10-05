// Edit / delete one saved insight — its author only (admins/managers can read
// every rep's, but not change them). Both are recorded on the contact
// Timeline, visible to the same people who can read the insight itself.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { logContactEvent, insightVisibility, htmlToText, excerpt } from "@/lib/crm/contactEvents";

async function loadInsight(params: { id: string; insightId: string }, user: { id: string; role: string }) {
  const res = await loadContactForUser(params.id, user, "view");
  if (!("contact" in res)) return res;
  const insight = await prisma.contactInsight.findUnique({ where: { id: params.insightId } });
  if (!insight || insight.deletedAt || insight.accountContactId !== params.id) return { error: "not_found" as const, status: 404 };
  if (insight.authorUserId !== user.id) return { error: "forbidden" as const, status: 403 };
  return { insight };
}

const label = (title: string | null, body: string) => title?.trim() || excerpt(htmlToText(body)) || "Insight";

const patchSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().max(200_000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string; insightId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadInsight(params, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const title = parsed.data.title !== undefined ? parsed.data.title || null : res.insight.title;
  const body = parsed.data.body ?? res.insight.body;
  if (title === res.insight.title && body === res.insight.body) return NextResponse.json({ insight: res.insight });

  const insight = await prisma.contactInsight.update({ where: { id: res.insight.id }, data: { title, body } });
  await logContactEvent({
    contactId: params.id,
    actorUserId: user.id,
    kind: "insight_edited",
    summary: `Insight edited — ${label(title, body)}`,
    visibility: insightVisibility(res.insight.authorUserId),
    refId: insight.id,
  });
  return NextResponse.json({ insight });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; insightId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadInsight(params, user);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  await prisma.contactInsight.update({ where: { id: res.insight.id }, data: { deletedAt: new Date() } });
  await logContactEvent({
    contactId: params.id,
    actorUserId: user.id,
    kind: "insight_deleted",
    summary: `Insight deleted — ${label(res.insight.title, res.insight.body)}`,
    visibility: insightVisibility(res.insight.authorUserId),
    refId: res.insight.id,
  });
  return NextResponse.json({ ok: true });
}
