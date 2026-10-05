import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageAllCustomers } from "@/lib/rbac";
import { del } from "@vercel/blob";
import { logContactEvent } from "@/lib/crm/contactEvents";

// The file itself is removed from Blob storage; the row stays (deletedAt) so
// the contact Timeline still shows the upload and when it was deleted.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const attachment = await prisma.accountContactAttachment.findUnique({
    where: { id: params.attachmentId },
    select: { id: true, accountContactId: true, fileName: true, fileUrl: true, uploadedByUserId: true, deletedAt: true },
  });
  if (!attachment || attachment.deletedAt || attachment.accountContactId !== params.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Uploader, or an admin/manager, can remove it.
  if (!canManageAllCustomers(user.role) && attachment.uploadedByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.accountContactAttachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
  await del(attachment.fileUrl).catch(() => null); // best-effort — the row is already marked deleted either way
  await logContactEvent({
    contactId: params.id,
    actorUserId: user.id,
    kind: "file_deleted",
    summary: `File deleted — ${attachment.fileName}`,
    refId: attachment.id,
  });

  return NextResponse.json({ ok: true });
}
