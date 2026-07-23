// Bulk "Move to Leads" (or undo) — the multi-select counterpart to
// PATCH /api/account-contacts/[id]'s pipelineStage write. Same per-item
// owner-or-admin scoping and granular skip-counting convention as
// bulk-delete/route.ts. "converted" is never stored — it's derived from a
// contact having a Deal — so the only values accepted here are "LEAD" / null.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

const schema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(200),
  pipelineStage: z.enum(["LEAD"]).nullable(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const contacts = await prisma.accountContact.findMany({
    where: { id: { in: parsed.data.contactIds }, deletedAt: null },
    select: { id: true, account: { select: { ownerUserId: true } } },
  });

  const allowedIds: string[] = [];
  let skippedForbidden = 0;
  for (const contact of contacts) {
    if (!isAdmin(user.role) && contact.account.ownerUserId && contact.account.ownerUserId !== user.id) {
      skippedForbidden++;
      continue;
    }
    allowedIds.push(contact.id);
  }

  if (allowedIds.length) {
    await prisma.accountContact.updateMany({
      where: { id: { in: allowedIds } },
      data: { pipelineStage: parsed.data.pipelineStage },
    });
  }

  return NextResponse.json({ updated: allowedIds.length, skippedForbidden });
}
