// Delete a media record. Note: we do NOT delete the underlying Vercel Blob
// (it may still be referenced by an old Message). The /media library hides
// the row; orphaned blobs are reclaimed via a future cleanup job.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const m = await prisma.media.findUnique({ where: { id: params.id } });
  if (!m) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Author or admin may delete
  if (m.uploadedByUserId !== user.id && user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.media.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
