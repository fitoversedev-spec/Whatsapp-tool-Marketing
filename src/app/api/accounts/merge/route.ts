// Merge N secondary Accounts into a primary — irreversible, admin-only.
// UI must show a confirm step (same caution as /api/contacts/merge).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mergeAccounts } from "@/lib/crm/accounts";

const schema = z.object({
  primaryId: z.string().uuid(),
  secondaryIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const { primaryId, secondaryIds } = parsed.data;
  if (secondaryIds.includes(primaryId)) {
    return NextResponse.json({ error: "Primary id cannot also be secondary" }, { status: 400 });
  }

  const primary = await prisma.account.findUnique({ where: { id: primaryId } });
  if (!primary) return NextResponse.json({ error: "primary not found" }, { status: 404 });

  await mergeAccounts(primaryId, secondaryIds);

  return NextResponse.json({ ok: true, mergedInto: primaryId, droppedCount: secondaryIds.length });
}
