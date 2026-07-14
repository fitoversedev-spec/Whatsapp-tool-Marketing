// Appends the customer's sport catalogue as extra pages after a rendered
// quotation PDF — same pdf-lib page-merge technique combined-pdf.ts uses to
// fold the quote into a court-design PDF (PDFDocument.load + copyPages).
//
// Prefers the admin-uploaded catalogue PDF (Setting key catalogue_<sport>_url,
// same override the catalogue send route uses) and falls back to
// auto-rendering one from featured portfolio projects. Never throws — a
// missing/broken catalogue must not break the quotation itself.
//
// getSportCatalogueBytes and mergeCatalogueIntoQuote are exported separately
// so a caller can fetch the catalogue CONCURRENTLY with rendering the quote
// PDF (the admin-uploaded override can be several MB — fetching it after the
// quote has already rendered adds that whole download to the critical path).
//
// The admin's file itself is also cached to our own Blob storage the first
// time it's fetched (Setting key catalogue_<sport>_cache, {sourceUrl,
// blobUrl}) — every quotation is a brand-new row with no pdfUrl yet, so
// without this every single quote preview re-downloads the override from
// scratch. The cache is keyed to the override's URL, so uploading a new
// catalogue automatically busts it.
//
// MAX_OVERRIDE_BYTES guards against an oversized upload (a raw Canva/print
// export can run 50MB+, almost entirely uncompressed photos) stalling or
// silently dropping the catalogue from EVERY quote/design generated for
// that sport — no amount of caching makes a 50MB transfer fast, so a file
// past this size is skipped in favour of the lightweight auto-rendered
// fallback until it's re-exported at a reasonable size.

import { PDFDocument, PageSizes, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { uploadToBlob } from "@/lib/media";
import { renderCatalogue, type FeaturedProject } from "@/lib/catalogue/pdf";
import { getSportMeta, type SportKey } from "@/lib/catalogue/sport-meta";

// Shared with the upload endpoint (src/app/api/catalogues/[sport]/upload)
// so the admin UI rejects an oversized file at upload time instead of
// silently falling back to the auto-rendered catalogue at fetch time.
export const MAX_OVERRIDE_BYTES = 15 * 1024 * 1024;

async function getCachedOverrideBytes(sport: string, sourceUrl: string): Promise<Uint8Array | null> {
  const entry = await prisma.setting.findUnique({ where: { key: `catalogue_${sport}_cache` } });
  if (!entry?.value) return null;
  let cache: { sourceUrl?: string; blobUrl?: string };
  try {
    cache = JSON.parse(entry.value);
  } catch {
    return null;
  }
  if (cache.sourceUrl !== sourceUrl || !cache.blobUrl) return null;
  try {
    const r = await fetch(cache.blobUrl, { signal: AbortSignal.timeout(15000) });
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
  } catch {
    // our own cached blob is unreachable — caller re-fetches the original
    // and repopulates the cache below
  }
  return null;
}

async function cacheOverrideBytes(sport: string, sourceUrl: string, bytes: Uint8Array) {
  try {
    const uploaded = await uploadToBlob({
      bytes: Buffer.from(bytes),
      fileName: `${sport}-catalogue-cache.pdf`,
      mimeType: "application/pdf",
      folder: "catalogue-cache",
    });
    const value = JSON.stringify({ sourceUrl, blobUrl: uploaded.url });
    await prisma.setting.upsert({
      where: { key: `catalogue_${sport}_cache` },
      create: { key: `catalogue_${sport}_cache`, value },
      update: { value },
    });
  } catch (err) {
    // Best-effort — a failed cache write just means the next request
    // re-fetches from the original source too; it doesn't affect this one.
    console.error("[quotation] catalogue cache write failed for", sport, err);
  }
}

export async function getSportCatalogueBytes(sport: string): Promise<Uint8Array | null> {
  try {
    const override = await prisma.setting.findUnique({
      where: { key: `catalogue_${sport}_url` },
    });
    if (override?.value) {
      const cached = await getCachedOverrideBytes(sport, override.value);
      if (cached) return cached;
      try {
        const r = await fetch(override.value, { signal: AbortSignal.timeout(20000) });
        const len = Number(r.headers.get("content-length") ?? 0);
        if (len > MAX_OVERRIDE_BYTES) {
          console.warn(
            `[quotation] catalogue override for ${sport} is ${(len / 1024 / 1024).toFixed(1)}MB` +
              ` (over the ${MAX_OVERRIDE_BYTES / 1024 / 1024}MB cap) — using the auto-rendered` +
              ` fallback instead. Re-export/compress the uploaded catalogue to fix this.`,
          );
        } else if (r.ok) {
          const bytes = new Uint8Array(await r.arrayBuffer());
          await cacheOverrideBytes(sport, override.value, bytes);
          return bytes;
        }
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
  } catch (err) {
    console.error("[quotation] catalogue fetch/render failed for", sport, err);
    return null;
  }
}

// Admin-uploaded catalogues (Canva/print exports, etc.) are rarely A4 — a
// square social post or a landscape poster merged in as-is leaves the
// combined PDF with a visibly different-sized page, which readers show as a
// mismatched thumbnail. Scale (preserving aspect ratio, no distortion) to
// fit within the quote's page size, then pad + center so every page in the
// merged document reports the exact same box.
function normalizeToPageSize(pg: PDFPage, [targetW, targetH]: readonly [number, number]) {
  const { width, height } = pg.getSize();
  if (Math.abs(width - targetW) < 0.5 && Math.abs(height - targetH) < 0.5) return;
  const scale = Math.min(targetW / width, targetH / height);
  pg.scale(scale, scale);
  const scaled = pg.getSize();
  pg.setSize(targetW, targetH);
  pg.translateContent((targetW - scaled.width) / 2, (targetH - scaled.height) / 2);
}

export async function mergeCatalogueIntoQuote(
  quotePdfBytes: Uint8Array,
  catalogueBytes: Uint8Array | null,
): Promise<Uint8Array> {
  if (!catalogueBytes) return quotePdfBytes;
  try {
    const doc = await PDFDocument.load(quotePdfBytes);
    const src = await PDFDocument.load(catalogueBytes);
    const copied = await doc.copyPages(src, src.getPageIndices());
    for (const pg of copied) {
      normalizeToPageSize(pg, PageSizes.A4);
      doc.addPage(pg);
    }
    return await doc.save();
  } catch (err) {
    console.error("[quotation] catalogue merge failed", err);
    return quotePdfBytes;
  }
}

export async function attachSportCatalogue(
  quotePdfBytes: Uint8Array,
  sport: string,
): Promise<Uint8Array> {
  const catalogueBytes = await getSportCatalogueBytes(sport);
  return mergeCatalogueIntoQuote(quotePdfBytes, catalogueBytes);
}
