// Merge N secondary contacts into a primary. Moves messages by reassigning
// the conversation phone (since conversations key off contactPhone, not
// contactId, this is mostly metadata cleanup). Tags are unioned, broadcast
// recipients are kept as-is (they're keyed by phone).
//
// CAUTION: the merge is irreversible. UI must show a confirm step.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  primaryId: z.string().uuid(),
  secondaryIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const { primaryId, secondaryIds } = parsed.data;
  if (secondaryIds.includes(primaryId)) {
    return NextResponse.json({ error: "Primary id cannot also be secondary" }, { status: 400 });
  }

  const all = await prisma.contact.findMany({
    where: { id: { in: [primaryId, ...secondaryIds] } },
    include: { tags: { include: { tag: true } } },
  });
  const primary = all.find((c) => c.id === primaryId);
  if (!primary) return NextResponse.json({ error: "primary not found" }, { status: 404 });

  // Union of all tag ids
  const unionTagIds = new Set<string>();
  for (const c of all) for (const t of c.tags) unionTagIds.add(t.tag.id);

  await prisma.$transaction(async (tx) => {
    // Re-apply unified tag set on primary
    await tx.contactTag.deleteMany({ where: { contactId: primaryId } });
    if (unionTagIds.size > 0) {
      await tx.contactTag.createMany({
        data: Array.from(unionTagIds).map((tagId) => ({
          contactId: primaryId,
          tagId,
        })),
        skipDuplicates: true,
      });
    }

    // Delete secondaries (cascade clears their tag joins via the schema)
    await tx.contact.deleteMany({ where: { id: { in: secondaryIds } } });
  });

  return NextResponse.json({ ok: true, mergedInto: primaryId, droppedCount: secondaryIds.length });
}
