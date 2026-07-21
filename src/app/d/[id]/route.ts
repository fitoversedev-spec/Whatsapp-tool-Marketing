// Public, unauthenticated redirect to a court design's media — same
// reasoning as src/app/q/[id]/route.ts (clean on-domain link for the
// customer-facing WhatsApp Web message, keyed by UUID not the sequential
// design number). ?format=2d|3d-image|3d-video picks which saved variant
// to redirect to; defaults to 2d.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const row = await prisma.courtImage.findUnique({
    where: { id: params.id },
    select: { imageUrl: true, image2dUrl: true, image3dUrl: true, video3dUrl: true },
  });
  if (!row) return new NextResponse("Not found", { status: 404 });

  const format = req.nextUrl.searchParams.get("format") ?? "2d";
  const url =
    format === "3d-image" ? row.image3dUrl :
    format === "3d-video" ? row.video3dUrl :
    row.image2dUrl ?? row.imageUrl;

  if (!url) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(url);
}
