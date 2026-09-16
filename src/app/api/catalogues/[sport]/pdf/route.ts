// Generate + serve a sport-specific catalogue PDF. If an uploaded
// Fitoverse-authored catalogue PDF has been registered for this sport
// (Setting key `catalogue_<sport>_url`), fetch it, inject fresh
// "Recent Projects" pages from featured portfolio projects before the
// last page, and serve the merged result. This way portfolio updates
// always propagate — even when the base PDF is a static admin upload.
//
// When no override exists, falls back to the auto generator (which
// inlines featured portfolio projects end to end).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderCatalogue } from "@/lib/catalogue/pdf";
import { getSportMeta, type SportKey } from "@/lib/catalogue/sport-meta";
import {
  queryFeaturedProjects,
  injectProjectPagesIntoOverride,
} from "@/lib/quotation/attach-catalogue";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { sport: string } }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const meta = getSportMeta(params.sport);
  if (!meta) return new NextResponse("unknown sport", { status: 404 });

  // Override path: fetch the admin-uploaded PDF and inject recent
  // featured project pages so portfolio changes propagate.
  const override = await prisma.setting.findUnique({
    where: { key: `catalogue_${params.sport}_url` },
  });
  if (override?.value) {
    try {
      const [overrideRes, projects] = await Promise.all([
        fetch(override.value, { signal: AbortSignal.timeout(40000) }),
        queryFeaturedProjects(params.sport),
      ]);

      if (overrideRes.ok) {
        const overrideBytes = new Uint8Array(await overrideRes.arrayBuffer());
        const merged = await injectProjectPagesIntoOverride(overrideBytes, projects);
        return new NextResponse(merged, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="fitoverse-${params.sport}-catalogue.pdf"`,
            "Cache-Control": "private, no-cache",
          },
        });
      }
      // Override fetch failed — fall through to auto-generated path.
      console.warn(
        `[catalogue/pdf] override fetch failed (${overrideRes.status}), falling back to auto-render`,
      );
    } catch (err) {
      console.warn("[catalogue/pdf] override fetch/inject failed, falling back:", err);
    }
  }

  // Auto-generated path: render the full catalogue from scratch.
  const projects = await queryFeaturedProjects(params.sport);

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
