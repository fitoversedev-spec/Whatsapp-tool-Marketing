// A rep's private insights on a customer — each Save adds a separate entry
// (rich-text HTML from the editor). Anyone who can view the customer keeps
// their own; the contact page shows admins/managers every rep's, read-only.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { htmlToText } from "@/lib/crm/contactEvents";

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  body: z.string().max(200_000),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "view");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  if (!htmlToText(parsed.data.body) && !parsed.data.title) {
    return NextResponse.json({ error: "Write something first" }, { status: 400 });
  }

  const insight = await prisma.contactInsight.create({
    data: { accountContactId: params.id, authorUserId: user.id, title: parsed.data.title || null, body: parsed.data.body },
  });
  return NextResponse.json({ insight });
}
