// List media for the library. Supports a category filter (image/video/etc).
// Returns the most recent first.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cat = req.nextUrl.searchParams.get("category");
  const where = cat ? { category: cat } : {};

  const media = await prisma.media.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { uploadedBy: { select: { name: true } } },
  });

  return NextResponse.json({
    media: media.map((m) => ({
      id: m.id,
      url: m.url,
      mimeType: m.mimeType,
      fileName: m.fileName,
      size: m.size,
      category: m.category,
      uploadedByName: m.uploadedBy.name,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// Bulk delete — mirrors the single-item DELETE's owner-or-admin rule
// (src/app/api/media/[id]/route.ts): a non-admin can only delete their own
// uploads, so the where-clause scopes to their own ids when not admin. The
// returned count may be lower than ids.length if the caller passed ids they
// don't own — the UI only ever offers checkboxes on rows it already knows
// the user is allowed to delete, so this is a safety net, not the common
// path. We do NOT delete the underlying Vercel Blob (same reasoning as the
// single-item route — it may still be referenced by an old Message).
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const result = await prisma.media.deleteMany({
    where: {
      id: { in: parsed.data.ids },
      ...(user.role !== "admin" ? { uploadedByUserId: user.id } : {}),
    },
  });
  return NextResponse.json({ ok: true, count: result.count });
}
