// Appends the customer's sport catalogue as extra pages after a rendered
// quotation PDF — same pdf-lib page-merge technique combined-pdf.ts uses to
// fold the quote into a court-design PDF (PDFDocument.load + copyPages).
//
// Prefers the admin-uploaded catalogue PDF (Setting key catalogue_<sport>_url,
// same override the catalogue send route uses) and falls back to
// auto-rendering one from featured portfolio projects. Never throws — a
// missing/broken catalogue must not break the quotation itself.

import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { renderCatalogue, type FeaturedProject } from "@/lib/catalogue/pdf";
import { getSportMeta, type SportKey } from "@/lib/catalogue/sport-meta";

async function getCatalogueBytes(sport: string): Promise<Uint8Array | null> {
  const override = await prisma.setting.findUnique({
    where: { key: `catalogue_${sport}_url` },
  });
  if (override?.value) {
    try {
      const r = await fetch(override.value, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch {
      // fall through to auto-render
    }
  }

  const meta = getSportMeta(sport);
  if (!meta) return null;
  const featured = await prisma.portfolioProject.findMany({
    where: { sport, featured: true, archived: false },
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
  const buf = await renderCatalogue(sport as SportKey, projects);
  return new Uint8Array(buf);
}

export async function attachSportCatalogue(
  quotePdfBytes: Uint8Array,
  sport: string,
): Promise<Uint8Array> {
  let catalogueBytes: Uint8Array | null;
  try {
    catalogueBytes = await getCatalogueBytes(sport);
  } catch (err) {
    console.error("[quotation] catalogue fetch/render failed for", sport, err);
    return quotePdfBytes;
  }
  if (!catalogueBytes) return quotePdfBytes;

  try {
    const doc = await PDFDocument.load(quotePdfBytes);
    const src = await PDFDocument.load(catalogueBytes);
    const copied = await doc.copyPages(src, src.getPageIndices());
    for (const pg of copied) doc.addPage(pg);
    return await doc.save();
  } catch (err) {
    console.error("[quotation] catalogue merge failed for", sport, err);
    return quotePdfBytes;
  }
}
