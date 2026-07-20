// Deletes every row a batch CREATED (never rows it merely updated — those
// were never stamped with importBatchId in the first place, see
// src/lib/import/dedupe.ts's commitRow). Available for 24h, matching the
// spec's "Undo this import" window.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function DELETE(_req: NextRequest, { params }: { params: { batchId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const batch = await prisma.importBatch.findUnique({ where: { id: params.batchId } });
  if (!batch) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isAdmin(user.role) && batch.importedByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (Date.now() - batch.createdAt.getTime() > UNDO_WINDOW_MS) {
    return NextResponse.json({ error: "This import is older than 24 hours and can no longer be undone" }, { status: 400 });
  }

  // Children before parents: AccountContact.account and Deal.account both
  // cascade on delete, so deleting Account first would silently cascade
  // away any same-batch AccountContact/Deal rows before their own
  // deleteMany runs, undercounting them. Not reachable today (a single
  // batch only ever stamps one target type — see docs/DECISIONS.md) but
  // cheap to make order-independent rather than relying on that staying true.
  const [contacts, deals, accounts, leads] = await prisma.$transaction([
    prisma.accountContact.deleteMany({ where: { importBatchId: batch.id } }),
    prisma.deal.deleteMany({ where: { importBatchId: batch.id } }),
    prisma.account.deleteMany({ where: { importBatchId: batch.id } }),
    prisma.lead.deleteMany({ where: { importBatchId: batch.id } }),
  ]);

  return NextResponse.json({
    ok: true,
    deleted: accounts.count + contacts.count + leads.count + deals.count,
  });
}
