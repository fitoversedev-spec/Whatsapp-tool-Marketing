// List media for the library. Supports a category filter (image/video/etc).
// Returns the most recent first.

import { NextRequest, NextResponse } from "next/server";
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
