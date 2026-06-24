// Soft delete + restore for templates.
//
// Soft delete only hides the template from default UI views and removes
// it from the Broadcasts template picker. The template still exists on
// Meta's side — we don't call Meta's delete endpoint. Admin can restore
// the template via the "Show deleted" filter on the Templates page.
//
// Why soft delete instead of hard delete:
// - Preserves audit trail (who created it, when it was submitted, etc.)
// - Allows accidental-delete recovery
// - Avoids touching Meta's side (their copy is the source of truth)
// - Broadcast records that reference deleted templates remain intact

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// DELETE — soft delete (sets deletedAt). Admin only.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const t = await prisma.template.findUnique({ where: { id: params.id } });
  if (!t) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (t.deletedAt) return NextResponse.json({ error: "already_deleted" }, { status: 422 });

  await prisma.template.update({
    where: { id: params.id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true, deletedAt: new Date().toISOString() });
}

// PATCH — restore a soft-deleted template (clears deletedAt). Admin only.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.action !== "restore") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const t = await prisma.template.findUnique({ where: { id: params.id } });
  if (!t) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!t.deletedAt) return NextResponse.json({ error: "not_deleted" }, { status: 422 });

  await prisma.template.update({
    where: { id: params.id },
    data: { deletedAt: null },
  });

  return NextResponse.json({ ok: true, restored: true });
}
