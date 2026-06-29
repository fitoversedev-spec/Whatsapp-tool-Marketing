// Per-sport catalogue PDF generator. Called by /api/catalogues/[sport]/pdf
// on demand — no caching; takes ~200-400ms per render. Returns PDF
// bytes the route serves inline or pipes through to Vercel Blob for
// the WhatsApp send flow.
//
// Same pdf-lib + WinAnsi-sanitize patterns the quotation PDF uses. The
// Fitoverse logo is loaded once at module load (try/catch so missing
// logo degrades the cover without breaking the build).

import * as fs from "fs";
import * as path from "path";
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { getSportMeta, type SportKey, type SportMeta } from "./sport-meta";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const BLACK = rgb(0.06, 0.09, 0.16);
const SLATE = rgb(0.4, 0.46, 0.55);
const SLATE_LIGHT = rgb(0.6, 0.65, 0.72);
const GREEN = rgb(0.18, 0.55, 0.34);
const GREEN_LIGHT = rgb(0.85, 0.93, 0.88);
const LINE = rgb(0.85, 0.88, 0.92);
const WHITE = rgb(1, 1, 1);

// Load logo once at module load. The quotation PDF does the same; the
// path resolves on Vercel because /public ships with the deploy.
let LOGO_BYTES: Buffer | null = null;
try {
  LOGO_BYTES = fs.readFileSync(
    path.join(process.cwd(), "public", "quotation-assets", "image1.png")
  );
} catch {
  console.warn(
    "[catalogue/pdf] Logo not found at public/quotation-assets/image1.png"
  );
}

function sanitize(text: string): string {
  return text
    .replace(/₹/g, "Rs.")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[•●]/g, "*")
    .replace(/✓/g, "[v]")
    .replace(/✗/g, "[x]")
    .replace(/[ ]/g, " ")
    .replace(/[…]/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "");
}

type Ctx = {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  page: PDFPage;
  y: number;
  pageNumber: number;
  logoImg: PDFImage | null;
};

// Photo metadata downloaded for inclusion in the "featured projects"
// section. Photos are fetched from their URLs (Vercel Blob) and embedded
// as PNG/JPEG. If any fail to fetch we skip silently — never break the
// whole render for a missing image.
export type FeaturedProject = {
  customerName: string;
  location: string | null;
  completionDate: Date | null;
  plotLengthFt: number | null;
  plotWidthFt: number | null;
  surfaceType: string | null;
  surfaceGrade: string | null;
  shortDescription: string | null;
  heroPhotoUrl: string | null;
};

export async function renderCatalogue(
  sport: SportKey,
  featuredProjects: FeaturedProject[]
): Promise<Buffer> {
  const meta = getSportMeta(sport);
  if (!meta) throw new Error(`Unknown sport: ${sport}`);

  const doc = await PDFDocument.create();
  doc.setTitle(`Fitoverse ${meta.label} Catalogue`);
  doc.setAuthor("Fitoverse");
  doc.setSubject(`${meta.label} - build options + past projects`);
  doc.setCreator("Fitoverse WhatsApp Tool");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let logoImg: PDFImage | null = null;
  if (LOGO_BYTES) {
    try {
      logoImg = await doc.embedPng(LOGO_BYTES);
    } catch {
      logoImg = null;
    }
  }

  const ctx: Ctx = {
    doc,
    font,
    fontBold,
    page: null as unknown as PDFPage,
    y: 0,
    pageNumber: 0,
    logoImg,
  };

  // Pre-fetch + embed hero photos for the featured-projects section.
  // We do this once up front so renderProjectsSection can synchronously
  // call doc.embed{Png,Jpg} without juggling promises per row.
  const embeddedPhotos = await preloadProjectPhotos(doc, featuredProjects);

  newPage(ctx);
  drawCover(ctx, meta);

  newPage(ctx);
  heading1(ctx, "Overview");
  paragraph(ctx, meta.overview, 6);

  heading2(ctx, "What we build");
  drawTable(ctx, meta.variants.headers, meta.variants.rows, meta.variants.widthRatios);

  heading2(ctx, "Surface + spec tiers");
  for (const tier of meta.surfaceTiers) {
    drawTierCard(ctx, tier);
  }

  if (embeddedPhotos.length > 0) {
    newPage(ctx);
    heading1(ctx, "Recent Fitoverse projects");
    paragraph(
      ctx,
      "A small selection of recent builds. Photos + specs from past work for context on what you can expect.",
      4
    );
    for (const project of embeddedPhotos) {
      drawProjectCard(ctx, project);
    }
  }

  newPage(ctx);
  heading1(ctx, "Why Fitoverse");
  for (const reason of meta.whyFitoverse) {
    bullet(ctx, reason);
  }

  ctx.y -= 20;
  drawContactBlock(ctx);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ─────────────────────────────────────────────────────────────────────
//  Drawing primitives
// ─────────────────────────────────────────────────────────────────────

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([A4_WIDTH, A4_HEIGHT]);
  ctx.y = A4_HEIGHT - MARGIN;
  ctx.pageNumber += 1;
  drawHeaderFooter(ctx);
}

function drawHeaderFooter(ctx: Ctx) {
  if (ctx.pageNumber > 1) {
    ctx.page.drawText(sanitize("Fitoverse - Sports Infrastructure"), {
      x: MARGIN,
      y: A4_HEIGHT - 24,
      size: 8,
      font: ctx.font,
      color: SLATE_LIGHT,
    });
    ctx.page.drawLine({
      start: { x: MARGIN, y: A4_HEIGHT - 30 },
      end: { x: A4_WIDTH - MARGIN, y: A4_HEIGHT - 30 },
      thickness: 0.5,
      color: LINE,
    });
    ctx.page.drawText(`Page ${ctx.pageNumber}`, {
      x: A4_WIDTH - MARGIN - 36,
      y: 22,
      size: 8,
      font: ctx.font,
      color: SLATE_LIGHT,
    });
  }
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 28) {
    newPage(ctx);
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawLine(
  ctx: Ctx,
  text: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    after?: number;
  } = {}
) {
  const size = opts.size ?? 10.5;
  const font = opts.bold ? ctx.fontBold : ctx.font;
  const color = opts.color ?? BLACK;
  const indent = opts.indent ?? 0;
  const x = MARGIN + indent;
  const maxWidth = CONTENT_WIDTH - indent;
  const lines = wrapText(sanitize(text), font, size, maxWidth);
  for (const line of lines) {
    ensureSpace(ctx, size + 3);
    ctx.page.drawText(line, { x, y: ctx.y - size, size, font, color });
    ctx.y -= size + 3;
  }
  if (opts.after) ctx.y -= opts.after;
}

function heading1(ctx: Ctx, text: string) {
  ctx.y -= 14;
  ensureSpace(ctx, 36);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 18,
    width: 4,
    height: 22,
    color: GREEN,
  });
  drawLine(ctx, text, {
    size: 18,
    bold: true,
    color: GREEN,
    indent: 12,
    after: 6,
  });
}

function heading2(ctx: Ctx, text: string) {
  ctx.y -= 6;
  ensureSpace(ctx, 18);
  drawLine(ctx, text, { size: 13, bold: true, after: 3 });
}

function paragraph(ctx: Ctx, text: string, after = 4) {
  drawLine(ctx, text, { after });
}

function bullet(ctx: Ctx, text: string) {
  drawLine(ctx, `* ${text}`, { indent: 14, after: 1 });
}

function drawTable(
  ctx: Ctx,
  headers: string[],
  rows: string[][],
  widthRatios?: number[]
) {
  const cols = headers.length;
  const ratios = widthRatios ?? new Array(cols).fill(1);
  const totalRatio = ratios.reduce((s, r) => s + r, 0);
  const colWidths = ratios.map((r) => (CONTENT_WIDTH * r) / totalRatio);
  const colXs = [MARGIN];
  for (let i = 1; i < cols; i++) {
    colXs[i] = colXs[i - 1] + colWidths[i - 1];
  }

  ensureSpace(ctx, 30);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 16,
    width: CONTENT_WIDTH,
    height: 18,
    color: GREEN_LIGHT,
  });
  for (let i = 0; i < cols; i++) {
    ctx.page.drawText(sanitize(headers[i]), {
      x: colXs[i] + 6,
      y: ctx.y - 11,
      size: 9,
      font: ctx.fontBold,
      color: GREEN,
    });
  }
  ctx.y -= 20;

  for (const row of rows) {
    let maxLines = 1;
    const cellLines: string[][] = [];
    for (let i = 0; i < cols; i++) {
      const lines = wrapText(
        sanitize(row[i] ?? ""),
        ctx.font,
        10,
        colWidths[i] - 12
      );
      cellLines.push(lines);
      maxLines = Math.max(maxLines, lines.length);
    }
    const rowHeight = maxLines * 12 + 6;
    ensureSpace(ctx, rowHeight + 2);
    for (let i = 0; i < cols; i++) {
      let yy = ctx.y - 11;
      for (const line of cellLines[i]) {
        ctx.page.drawText(line, {
          x: colXs[i] + 6,
          y: yy,
          size: 10,
          font: ctx.font,
          color: BLACK,
        });
        yy -= 12;
      }
    }
    ctx.y -= rowHeight;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y + 2 },
      end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y + 2 },
      thickness: 0.3,
      color: LINE,
    });
  }
  ctx.y -= 6;
}

// Surface tier card — name + description + bulleted inclusions, framed
// in a light box so it visually separates from other tiers.
function drawTierCard(
  ctx: Ctx,
  tier: { name: string; description: string; inclusions: string[]; priceFromInr?: string }
) {
  const inclusionsCount = tier.inclusions.length;
  const estimatedHeight = 16 + 14 + inclusionsCount * 14 + 18;
  ensureSpace(ctx, estimatedHeight);
  const startY = ctx.y;

  // Frame
  ctx.page.drawRectangle({
    x: MARGIN,
    y: startY - estimatedHeight + 8,
    width: CONTENT_WIDTH,
    height: estimatedHeight - 8,
    color: WHITE,
    borderColor: LINE,
    borderWidth: 0.6,
  });

  // Header bar
  ctx.page.drawRectangle({
    x: MARGIN,
    y: startY - 22,
    width: CONTENT_WIDTH,
    height: 22,
    color: GREEN_LIGHT,
  });
  ctx.page.drawText(sanitize(tier.name), {
    x: MARGIN + 10,
    y: startY - 16,
    size: 12,
    font: ctx.fontBold,
    color: GREEN,
  });
  if (tier.priceFromInr) {
    const priceText = `from ${sanitize(tier.priceFromInr)}`;
    const priceW = ctx.fontBold.widthOfTextAtSize(priceText, 10);
    ctx.page.drawText(priceText, {
      x: MARGIN + CONTENT_WIDTH - priceW - 10,
      y: startY - 16,
      size: 10,
      font: ctx.fontBold,
      color: BLACK,
    });
  }

  ctx.y = startY - 30;
  // Description
  drawLine(ctx, tier.description, {
    size: 10,
    color: SLATE,
    indent: 10,
    after: 4,
  });
  // Inclusions
  for (const inc of tier.inclusions) {
    drawLine(ctx, `[v]  ${inc}`, { size: 10, indent: 14, after: 1 });
  }
  ctx.y -= 8;
}

// Project card with hero photo on the left and specs on the right.
function drawProjectCard(
  ctx: Ctx,
  project: FeaturedProject & { embeddedImage?: PDFImage | null }
) {
  const cardHeight = 130;
  const photoW = 150;
  const photoH = cardHeight - 16;
  ensureSpace(ctx, cardHeight + 8);
  const startY = ctx.y;

  // Frame
  ctx.page.drawRectangle({
    x: MARGIN,
    y: startY - cardHeight,
    width: CONTENT_WIDTH,
    height: cardHeight,
    color: WHITE,
    borderColor: LINE,
    borderWidth: 0.6,
  });

  // Photo area
  if (project.embeddedImage) {
    const img = project.embeddedImage;
    const aspect = img.width / img.height;
    let drawW = photoW;
    let drawH = photoW / aspect;
    if (drawH > photoH) {
      drawH = photoH;
      drawW = drawH * aspect;
    }
    const photoX = MARGIN + 8 + (photoW - drawW) / 2;
    const photoY = startY - cardHeight + 8 + (photoH - drawH) / 2;
    ctx.page.drawImage(img, { x: photoX, y: photoY, width: drawW, height: drawH });
  } else {
    // Placeholder block
    ctx.page.drawRectangle({
      x: MARGIN + 8,
      y: startY - cardHeight + 8,
      width: photoW,
      height: photoH,
      color: GREEN_LIGHT,
    });
    ctx.page.drawText(sanitize("No photo"), {
      x: MARGIN + 8 + photoW / 2 - 22,
      y: startY - cardHeight + 8 + photoH / 2 - 4,
      size: 9,
      font: ctx.font,
      color: SLATE_LIGHT,
    });
  }

  // Text area
  const textX = MARGIN + photoW + 20;
  const textMaxWidth = CONTENT_WIDTH - photoW - 28;

  let textY = startY - 14;
  ctx.page.drawText(sanitize(project.customerName), {
    x: textX,
    y: textY,
    size: 13,
    font: ctx.fontBold,
    color: BLACK,
  });
  textY -= 16;

  if (project.location) {
    ctx.page.drawText(sanitize(project.location), {
      x: textX,
      y: textY,
      size: 10,
      font: ctx.font,
      color: SLATE,
    });
    textY -= 14;
  }

  // Specs line
  const specBits: string[] = [];
  if (project.plotLengthFt && project.plotWidthFt) {
    specBits.push(`${project.plotLengthFt} x ${project.plotWidthFt} ft`);
  }
  if (project.surfaceType) specBits.push(project.surfaceType);
  if (project.surfaceGrade) specBits.push(project.surfaceGrade);
  if (project.completionDate) {
    specBits.push(
      project.completionDate.toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      })
    );
  }
  if (specBits.length > 0) {
    ctx.page.drawText(sanitize(specBits.join("  *  ")), {
      x: textX,
      y: textY,
      size: 9,
      font: ctx.font,
      color: SLATE,
    });
    textY -= 12;
  }

  if (project.shortDescription) {
    const descLines = wrapText(
      sanitize(project.shortDescription),
      ctx.font,
      9.5,
      textMaxWidth
    );
    for (const line of descLines.slice(0, 4)) {
      ctx.page.drawText(line, {
        x: textX,
        y: textY,
        size: 9.5,
        font: ctx.font,
        color: BLACK,
      });
      textY -= 12;
      if (textY < startY - cardHeight + 12) break;
    }
  }

  ctx.y = startY - cardHeight - 8;
}

function drawContactBlock(ctx: Ctx) {
  ensureSpace(ctx, 110);
  const startY = ctx.y;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: startY - 100,
    width: CONTENT_WIDTH,
    height: 100,
    color: GREEN_LIGHT,
  });
  ctx.page.drawText(sanitize("Ready to start your build?"), {
    x: MARGIN + 16,
    y: startY - 22,
    size: 15,
    font: ctx.fontBold,
    color: GREEN,
  });
  ctx.page.drawText(
    sanitize(
      "Reply on WhatsApp with your plot dimensions, location, and primary sport - we'll send a custom quote within 24 hours."
    ),
    {
      x: MARGIN + 16,
      y: startY - 42,
      size: 10.5,
      font: ctx.font,
      color: BLACK,
    }
  );
  ctx.page.drawText(sanitize("Fitoverse Sports Infrastructure"), {
    x: MARGIN + 16,
    y: startY - 68,
    size: 11,
    font: ctx.fontBold,
    color: BLACK,
  });
  ctx.page.drawText(sanitize("+91 93638 63382  *  fitoverse.in"), {
    x: MARGIN + 16,
    y: startY - 84,
    size: 10,
    font: ctx.font,
    color: SLATE,
  });
  ctx.y = startY - 110;
}

function drawCover(ctx: Ctx, meta: SportMeta) {
  // Background hero rectangle
  ctx.page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 360,
    width: A4_WIDTH,
    height: 360,
    color: GREEN_LIGHT,
  });

  if (ctx.logoImg) {
    const targetW = 130;
    const targetH = (ctx.logoImg.height / ctx.logoImg.width) * targetW;
    ctx.page.drawImage(ctx.logoImg, {
      x: (A4_WIDTH - targetW) / 2,
      y: A4_HEIGHT - 180,
      width: targetW,
      height: targetH,
    });
  }

  // Sport name
  const titleSize = 32;
  const title = sanitize(meta.label);
  const titleW = ctx.fontBold.widthOfTextAtSize(title, titleSize);
  ctx.page.drawText(title, {
    x: (A4_WIDTH - titleW) / 2,
    y: A4_HEIGHT - 250,
    size: titleSize,
    font: ctx.fontBold,
    color: BLACK,
  });

  // Tagline
  const taglineSize = 12;
  const taglineLines = wrapText(
    sanitize(meta.tagline),
    ctx.font,
    taglineSize,
    A4_WIDTH - 80
  );
  let ty = A4_HEIGHT - 285;
  for (const line of taglineLines) {
    const w = ctx.font.widthOfTextAtSize(line, taglineSize);
    ctx.page.drawText(line, {
      x: (A4_WIDTH - w) / 2,
      y: ty,
      size: taglineSize,
      font: ctx.font,
      color: SLATE,
    });
    ty -= 16;
  }

  // Catalogue label at the bottom
  const labelText = "CATALOGUE";
  const labelSize = 11;
  const labelW = ctx.fontBold.widthOfTextAtSize(sanitize(labelText), labelSize);
  ctx.page.drawText(sanitize(labelText), {
    x: (A4_WIDTH - labelW) / 2,
    y: 70,
    size: labelSize,
    font: ctx.fontBold,
    color: GREEN,
  });
  const credit = "Fitoverse - Sports Infrastructure";
  const creditW = ctx.font.widthOfTextAtSize(sanitize(credit), 10);
  ctx.page.drawText(sanitize(credit), {
    x: (A4_WIDTH - creditW) / 2,
    y: 50,
    size: 10,
    font: ctx.font,
    color: SLATE,
  });
}

// ─────────────────────────────────────────────────────────────────────
//  Photo pre-loading
// ─────────────────────────────────────────────────────────────────────

async function preloadProjectPhotos(
  doc: PDFDocument,
  projects: FeaturedProject[]
): Promise<Array<FeaturedProject & { embeddedImage: PDFImage | null }>> {
  const out: Array<FeaturedProject & { embeddedImage: PDFImage | null }> = [];
  for (const p of projects) {
    let embeddedImage: PDFImage | null = null;
    if (p.heroPhotoUrl) {
      try {
        const res = await fetch(p.heroPhotoUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const contentType = res.headers.get("content-type") ?? "";
          if (contentType.includes("png") || p.heroPhotoUrl.endsWith(".png")) {
            embeddedImage = await doc.embedPng(buf);
          } else {
            // Try JPEG by default; pdf-lib handles JPEGs but is picky on
            // PNG signature so we don't try PNG fallback.
            embeddedImage = await doc.embedJpg(buf);
          }
        }
      } catch (err) {
        // Don't break the whole render for one bad photo.
        console.warn(
          `[catalogue/pdf] could not embed hero photo for ${p.customerName}:`,
          err
        );
      }
    }
    out.push({ ...p, embeddedImage });
  }
  return out;
}
