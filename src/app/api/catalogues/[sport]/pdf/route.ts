// Generate + serve a sport-specific catalogue PDF. If an uploaded
// Fitoverse-authored catalogue PDF has been registered for this sport
// (Setting key `catalogue_<sport>_url`), redirect to it directly so the
// customer sees the polished marketing PDF instead of the auto-rendered
// one. Otherwise fall back to the auto generator (which inlines featured
// portfolio projects).

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

  // Override: if admin has uploaded a real catalogue PDF for this sport,
  // serve that instead of running the auto-generator.
  const override = await prisma.setting.findUnique({
    where: { key: `catalogue_${params.sport}_url` },
  });
  if (override?.value) {
    return NextResponse.redirect(override.value, { status: 302 });
  }

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
