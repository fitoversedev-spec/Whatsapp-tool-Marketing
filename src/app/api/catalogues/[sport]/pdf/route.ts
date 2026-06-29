// Generate + serve a sport-specific catalogue PDF. Reads featured
// portfolio projects from the DB and inlines their hero photos.
// Inline-disposed so the wizard preview iframe renders it.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderCatalogue, type FeaturedProject } from "@/lib/catalogue/pdf";
import { getSportMeta, type SportKey } from "@/lib/catalogue/sport-meta";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { sport: string } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const meta = getSportMeta(params.sport);
  if (!meta) return new NextResponse("unknown sport", { status: 404 });

  const featured = await prisma.portfolioProject.findMany({
    where: { sport: params.sport, featured: true, archived: false },
    orderBy: [{ completionDate: "desc" }, { createdAt: "desc" }],
    take: 6,
  });

  const projects: FeaturedProject[] = featured.map((p) => ({
    customerName: p.customerName,
    location: p.location,
    completionDate: p.completionDate,
    plotLengthFt: p.plotLengthFt,
    plotWidthFt: p.plotWidthFt,
    surfaceType: p.surfaceType,
    surfaceGrade: p.surfaceGrade,
    shortDescription: p.shortDescription,
    heroPhotoUrl: p.heroPhotoUrl,
  }));

  try {
    const pdfBuffer = await renderCatalogue(params.sport as SportKey, projects);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="fitoverse-${params.sport}-catalogue.pdf"`,
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    console.error("[catalogue/pdf] render failed", err);
    return new NextResponse("render failed", { status: 500 });
  }
}
