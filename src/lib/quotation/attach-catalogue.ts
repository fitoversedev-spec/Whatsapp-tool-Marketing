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
// The override is always used as-uploaded — never resized/recompressed —
// so what the admin designed is what the customer gets. A generous timeout
// is the only bound: a fetch that genuinely can't complete in time falls
// back to the auto-rendered catalogue rather than hanging the request.

import { PDFDocument, PageSizes, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { renderCatalogue, type FeaturedProject } from "@/lib/catalogue/pdf";
import { getSportMeta, type SportKey } from "@/lib/catalogue/sport-meta";

// Not a performance cutoff — WhatsApp's own document-message limit
// (src/lib/media.ts MAX_SIZE.document). A catalogue past this can never be
// sent as-is regardless of how fast it loads, so the upload endpoint
// (api/catalogues/[sport]/upload) rejects it there instead of failing later
// at send time.
export const MAX_OVERRIDE_BYTES = 90 * 1024 * 1024;

// Curated page selection for the admin-uploaded override deck — the full
// marketing PDF runs 24 pages (team bios, per-product spec sheets, etc.);
// every quote keeps only these sections, in this order:
// Custom Designed [Sport] cover, Origin Story, Proud Members Of, What Our
// Customers Speak About Us, Custom Designed To Fit Your Property, the
// injury/risk page, We Solve This With Flooring, Why Choose Fitoverse, One
// Place For Every Passion, Everything You Need In One Place, Fitoverse QR.
// Verified page-by-page against the actual 24-page football catalogue.
// The same numbers are applied to the other overrides below since all 5
// share one company template — only the cover and a couple of
// sport-specific pages differ in CONTENT, not position. If a particular
// sport's catalogue turns out laid out differently, give that sport its
// own entry here instead of FOOTBALL_TEMPLATE_PAGES.
//
// Applied ONCE, at upload time (api/catalogues/[sport]/upload) — NOT on
// every quote request. The raw upload can be 50MB+; fetching that in full
// on every single quote (even just to throw most of it away afterward) is
// what made the catalogue unreliable in the first place. The Setting this
// module reads always points at the already-curated ~1-3MB file, so the
// request-time path here is just "fetch and use it" — fast by construction.
const FOOTBALL_TEMPLATE_PAGES = [1, 2, 5, 6, 8, 9, 10, 21, 23, 19, 24];
const CURATED_PAGES: Partial<Record<string, number[]>> = {
  football: FOOTBALL_TEMPLATE_PAGES,
  basketball: FOOTBALL_TEMPLATE_PAGES,
  pickleball: FOOTBALL_TEMPLATE_PAGES,
  badminton: FOOTBALL_TEMPLATE_PAGES,
  multisport: FOOTBALL_TEMPLATE_PAGES,
};

export function hasCuratedPages(sport: string): boolean {
  return !!CURATED_PAGES[sport];
}

export async function curateOverridePages(bytes: Uint8Array, sport: string): Promise<Uint8Array> {
  const wanted = CURATED_PAGES[sport];
  if (!wanted) return bytes;
  const src = await PDFDocument.load(bytes);
  const maxPage = src.getPageCount();
  const indices = wanted.filter((n) => n <= maxPage).map((n) => n - 1);
  if (indices.length === 0) return bytes;
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  for (const pg of copied) out.addPage(pg);
  return await out.save();
}

// In-memory, per-process cache of the fetched override bytes — even curated
// to ~11 pages, the deck is 20-25MB (unmodified source images), which measured
// 10-16s to fetch from Blob. That's uncomfortably close to the 40s timeout
// below, and every quote render was paying that cost freshly. Keyed by the
// Setting's URL itself, so a re-upload (which always gets a new blob path)
// invalidates automatically — no separate TTL/bust logic needed.
const catalogueCache = new Map<string, Uint8Array>();

export async function getSportCatalogueBytes(sport: string): Promise<Uint8Array | null> {
  try {
    const override = await prisma.setting.findUnique({
      where: { key: `catalogue_${sport}_url` },
    });
    if (override?.value) {
      const cached = catalogueCache.get(override.value);
      if (cached) return cached;
      try {
        // The stored file is already curated down to ~11 pages at upload
        // time — much smaller than the 50MB+ raw deck, but still large
        // enough (20-25MB) to need real headroom against a hung/slow fetch.
        const r = await fetch(override.value, { signal: AbortSignal.timeout(40000) });
        if (r.ok) {
          const bytes = new Uint8Array(await r.arrayBuffer());
          catalogueCache.set(override.value, bytes);
          return bytes;
        }
      } catch (err) {
        console.warn(
          `[quotation] catalogue override fetch failed for ${sport}, using the` +
            ` auto-rendered fallback instead:`,
          err,
        );
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
