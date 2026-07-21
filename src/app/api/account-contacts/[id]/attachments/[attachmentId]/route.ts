import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { del } from "@vercel/blob";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const attachment = await prisma.accountContactAttachment.findUnique({
    where: { id: params.attachmentId },
    select: { id: true, accountContactId: true, fileUrl: true, uploadedByUserId: true },
  });
  if (!attachment || attachment.accountContactId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Uploader or admin can remove it — same as who was allowed to add it.
  if (!isAdmin(user.role) && attachment.uploadedByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.accountContactAttachment.delete({ where: { id: attachment.id } });
  await del(attachment.fileUrl).catch(() => null); // best-effort — row is already gone either way

  return NextResponse.json({ ok: true });
}
