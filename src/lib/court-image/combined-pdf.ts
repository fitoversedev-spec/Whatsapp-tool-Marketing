// Combined court-design PDF — one document containing the 2D plan, the
// 3D image, the attached products, equipment, TDS list, and (optionally)
// a quote. Built on pdf-lib (same reason as the quotation PDF: no native
// deps, OneDrive-safe).
//
// Images: pdf-lib embeds PNG + JPG only. Product photos may be WEBP
// (from the old MVPv2 import) — those fail to embed, so we try png then
// jpg and fall back to a labelled placeholder box instead of crashing.

import {
  PDFDocument,
  StandardFonts,
  rgb,
  PageSizes,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { htmlToPlainText, extractHtmlTables } from "@/lib/products/format";
import type { ProductDTO } from "@/lib/products/store";
import type { DesignAreas } from "./schema";

const MARGIN = 40;
const [PAGE_W, PAGE_H] = PageSizes.A4;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COL = {
  ink: rgb(0.05, 0.07, 0.13),
  soft: rgb(0.28, 0.33, 0.41),
  faint: rgb(0.55, 0.6, 0.67),
  line: rgb(0.85, 0.88, 0.92),
  green: rgb(0.07, 0.55, 0.44),
  band: rgb(0.94, 0.96, 0.98),
};

export type CombinedQuote = {
  number: string;
  title?: string | null;
  notes?: string | null;
  items: Array<{
    name: string;
    desc?: string | null;
    qty?: number;
    unit?: string | null;
    rate?: number;
    total: number;
  }>;
  subtotal: number;
  gst: number;
  grandTotal: number;
};

export type CombinedPdfInput = {
  customerName: string;
  plotLabel: string;
  baseWork?: string | null;
  flooringName?: string | null;
  sports: string[];
  // Design renders (2D plan) as raw image bytes.
  designImages: Array<{ label: string; bytes: Uint8Array }>;
  // 3D turntable — a set of stills from every angle, laid out in a grid
  // so the customer sees the court from all sides in the static PDF.
  angleImages?: Uint8Array[];
  products: ProductDTO[];
  equipment: ProductDTO[];
  // Just the names, for the fallback list when the PDF bytes aren't merged.
  tds: Array<{ name: string }>;
  // Actual TDS PDF bytes — their pages are merged into this document so
  // the customer gets one PDF with the spec sheets inside (not a link).
  tdsPdfs?: Array<{ name: string; bytes: Uint8Array }>;
  quote?: CombinedQuote | null;
  // Pre-rendered stand-alone quotation PDF (renderQuotationPdf). When present,
  // its pages are merged in so the quote section matches a quote sent alone.
  quotePdf?: Uint8Array | null;
  // Structured plot / court dimensions, rendered as a dedicated table (the
  // dimensions card is hidden from the 2D diagram so the diagram stays clean).
  dimensions?: DesignAreas | null;
};

function sanitize(s: string): string {
  // WinAnsi (pdf-lib standard fonts) can't encode every unicode char.
  return s
    .replace(/[₹]/g, "Rs ")
    .replace(/[•·]/g, "-")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\t\n\r]+/g, " ")
    // Keep ONLY printable Latin-1 (ASCII 0x20-0x7E + 0xA0-0xFF). This strips
    // every control byte WinAnsi rejects — C0 (0x00-0x1F), DEL (0x7F) and C1
    // (0x80-0x9F) — as well as anything above Latin-1. A single stray NUL or
    // Windows-1252 mojibake byte from the MVPv2 import used to make drawText
    // throw and produce NO PDF at all; this laundering prevents that.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

async function tryEmbed(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<PDFImage | null> {
  try {
    return await doc.embedPng(bytes);
  } catch {
    try {
      return await doc.embedJpg(bytes);
    } catch {
      return null;
    }
  }
}

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
};

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 30) newPage(ctx);
}

function text(
  ctx: Ctx,
  s: string,
  opts: {
    x?: number;
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    maxWidth?: number;
  } = {},
) {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.font;
  const x = opts.x ?? MARGIN;
  const maxWidth = opts.maxWidth ?? CONTENT_W;
  const lines = wrap(font, sanitize(s), size, maxWidth);
  for (const line of lines) {
    ensure(ctx, size + 4);
    ctx.page.drawText(line, {
      x,
      y: ctx.y - size,
      size,
      font,
      color: opts.color ?? COL.ink,
    });
    ctx.y -= size + 3;
  }
}

function wrap(font: PDFFont, s: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function gap(ctx: Ctx, n = 8) {
  ctx.y -= n;
}

function sectionTitle(ctx: Ctx, title: string) {
  ensure(ctx, 30);
  gap(ctx, 10);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 18,
    width: CONTENT_W,
    height: 20,
    color: COL.band,
  });
  ctx.page.drawText(sanitize(title), {
    x: MARGIN + 8,
    y: ctx.y - 14,
    size: 11,
    font: ctx.bold,
    color: COL.green,
  });
  ctx.y -= 26;
}

export async function renderCombinedPdf(
  input: CombinedPdfInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN,
    font,
    bold,
  };

  // ── Cover / header ──
  ctx.page.drawText("Fitoverse", {
    x: MARGIN,
    y: ctx.y - 20,
    size: 20,
    font: bold,
    color: COL.green,
  });
  ctx.page.drawText("Court Design Proposal", {
    x: MARGIN,
    y: ctx.y - 38,
    size: 12,
    font,
    color: COL.soft,
  });
  ctx.y -= 54;
  text(ctx, `Customer: ${input.customerName || "-"}`, { size: 11, bold: true });
  text(ctx, `Sport: ${input.sports.map((s) => cap(s)).join(", ") || "-"}`, {
    color: COL.soft,
  });
  text(ctx, `Plot: ${input.plotLabel}`, { color: COL.soft });
  if (input.baseWork) text(ctx, `Base work: ${cap(input.baseWork)}`, { color: COL.soft });
  if (input.flooringName) text(ctx, `Flooring: ${input.flooringName}`, { color: COL.soft });

  // ── Page 1 — 2D court plan, filling the page under the header ──
  const twoD = input.designImages[0];
  if (twoD) {
    sectionTitle(ctx, "2D court plan");
    await drawImageFit(ctx, twoD.bytes, ctx.y - MARGIN - 24);
  }

  // ── Dimensions — a dedicated, easy-to-read table (kept OFF the 2D diagram) ──
  if (input.dimensions) {
    drawDimensionsTable(ctx, input.dimensions);
  }

  // ── 3D drone view — ONE static still on its own page (not every angle) ──
  if (input.angleImages && input.angleImages.length > 0) {
    newPage(ctx);
    await drawSingle3DView(ctx, input.angleImages[0]);
  }

  // ── Products & equipment — flow together across page(s), packed tight
  //    so neither section leaves a mostly-empty page. ──
  if (input.products.length > 0 || input.equipment.length > 0) {
    newPage(ctx);
    if (input.products.length > 0) {
      sectionTitle(ctx, "Flooring & materials");
      for (const p of input.products) await drawProduct(ctx, p);
    }
    if (input.equipment.length > 0) {
      // Small gap, then keep the header with at least one item on the page.
      if (input.products.length > 0) ctx.y -= 12;
      ensure(ctx, 96);
      sectionTitle(ctx, "Sports equipment");
      for (const p of input.equipment) await drawProduct(ctx, p);
    }
  }

  // ── Company portfolio — Connect with Fitoverse, before the attached PDFs ──
  drawConnectWithFitoverse(ctx);

  // ── Attached PDFs come LAST (per the proposal format): the TDS spec sheets,
  //    then the quotation. ──
  // ── TDS — merge the actual PDF pages so the spec sheets live INSIDE
  //    this one document (a divider page introduces each). Falls back to
  //    a titled list only if the bytes couldn't be fetched. ──
  const mergedTdsPages = new Set<PDFPage>();
  if (input.tdsPdfs && input.tdsPdfs.length > 0) {
    // Merge each sheet's actual pages DIRECTLY — no separate intro/title page.
    // A title-only divider page (just the product name) reads as a blank page
    // before the real spec sheet, which is the issue sales flagged.
    for (const t of input.tdsPdfs) {
      try {
        const src = await PDFDocument.load(t.bytes);
        const copied = await doc.copyPages(src, src.getPageIndices());
        for (const pg of copied) {
          doc.addPage(pg);
          mergedTdsPages.add(pg);
        }
      } catch {
        newPage(ctx);
        text(ctx, `(Could not embed "${t.name}" — please request the source PDF.)`, {
          color: COL.faint,
          size: 9,
        });
      }
    }
    // A TDS whose bytes never fetched (expired/403 URL, timeout) is present in
    // the name list but absent from tdsPdfs. Without this it would vanish with
    // zero indication as soon as ONE other TDS merged successfully — so list
    // the missing ones instead of silently dropping the spec sheet.
    const fetchedNames = new Set(input.tdsPdfs.map((t) => t.name));
    const missing = input.tds.filter((t) => !fetchedNames.has(t.name));
    if (missing.length > 0) {
      ensure(ctx, 40);
      gap(ctx, 8);
      sectionTitle(ctx, "Additional technical data sheets (available on request)");
      for (const t of missing) {
        ensure(ctx, 16);
        text(ctx, `- ${t.name}`, { size: 9.5 });
      }
    }
  } else if (input.tds.length > 0) {
    newPage(ctx);
    sectionTitle(ctx, "Technical data sheets (TDS)");
    for (const t of input.tds) {
      ensure(ctx, 16);
      text(ctx, `- ${t.name}`, { size: 9.5 });
    }
  }

  // ── Quotation — merge the stand-alone quote PDF pages so the quote section
  //    is identical to a quote sent on its own. Fall back to the built-in
  //    table only if the PDF wasn't provided / failed to load. ──
  if (input.quotePdf) {
    try {
      const src = await PDFDocument.load(input.quotePdf);
      const copied = await doc.copyPages(src, src.getPageIndices());
      for (const pg of copied) {
        doc.addPage(pg);
        // The quote PDF carries its own header/footer — skip the combined
        // footer on these pages (same set the merged TDS pages use).
        mergedTdsPages.add(pg);
      }
    } catch {
      if (input.quote) {
        newPage(ctx);
        drawQuote(ctx, input.quote);
      }
    }
  } else if (input.quote) {
    newPage(ctx);
    drawQuote(ctx, input.quote);
  }

  // ── Footer on every page (skip merged TDS pages so it doesn't overlap
  //    the original spec-sheet layout) ──
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    if (mergedTdsPages.has(pg)) return;
    pg.drawText(sanitize(`Fitoverse - +91 93638 63382   ·   Page ${i + 1} of ${pages.length}`), {
      x: MARGIN,
      y: 24,
      size: 8,
      font,
      color: COL.faint,
    });
  });

  return doc.save();
}

// Closing page — "Connect with Fitoverse": our website + social handles, so
// the proposal ends with a clear way to reach us (the company portfolio /
// contact section from the quotation template).
function drawConnectWithFitoverse(ctx: Ctx) {
  newPage(ctx);
  sectionTitle(ctx, "Connect with Fitoverse");
  gap(ctx, 4);
  text(ctx, "Explore our work and reach us here:", {
    color: COL.soft,
    size: 10.5,
  });
  gap(ctx, 8);
  const links: Array<[string, string]> = [
    ["Website", "https://fitoverse.com/"],
    ["Instagram", "https://www.instagram.com/fito.verse/"],
    ["Facebook", "https://www.facebook.com/profile.php?id=100077279349300"],
    ["Twitter (X)", "https://x.com/fitoverse"],
  ];
  for (const [label, url] of links) {
    ensure(ctx, 18);
    ctx.page.drawText(sanitize(`${label}:  ${url}`), {
      x: MARGIN,
      y: ctx.y - 11,
      size: 10.5,
      font: ctx.bold,
      color: COL.ink,
    });
    ctx.y -= 20;
  }
  gap(ctx, 10);
  text(ctx, "Fitoverse Private Limited   ·   +91 93638 63382", {
    color: COL.soft,
    size: 10,
  });
}

// Dedicated Dimensions page — a big, clear two-column table (Area | Size) with
// imperial + metric on separate lines. Kept off the 2D diagram so the diagram
// stays clean.
function drawDimensionsTable(ctx: Ctx, areas: DesignAreas) {
  newPage(ctx);
  sectionTitle(ctx, "Dimensions");
  gap(ctx, 10);
  const FT_M = 0.3048;
  const SQFT_SQM = 0.092903;
  const nf = (n: number) => Math.round(n).toLocaleString("en-IN");
  const ftv = (v: number) => {
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
  };
  const mtv = (v: number) => (v * FT_M).toFixed(2);

  // Group courts by sport + size so a multi-sport plot lists each named court.
  const groups: Array<{
    label: string;
    l: number;
    w: number;
    count: number;
    area: number;
  }> = [];
  for (const c of areas.courts) {
    const g = groups.find(
      (x) =>
        x.label === c.label &&
        Math.round(x.l) === Math.round(c.lengthFt) &&
        Math.round(x.w) === Math.round(c.widthFt),
    );
    if (g) {
      g.count += 1;
      g.area += c.areaSqFt;
    } else {
      groups.push({
        label: c.label,
        l: c.lengthFt,
        w: c.widthFt,
        count: 1,
        area: c.areaSqFt,
      });
    }
  }

  const rows: Array<{ label: string; imperial: string; metric: string }> = [];
  const p = areas.plot;
  rows.push({
    label: "Plot",
    imperial: `${ftv(p.lengthFt)} x ${ftv(p.widthFt)} ft  =  ${nf(p.areaSqFt)} sq.ft`,
    metric: `${mtv(p.lengthFt)} x ${mtv(p.widthFt)} m  =  ${nf(p.areaSqFt * SQFT_SQM)} sq.m`,
  });
  for (const g of groups) {
    rows.push({
      label:
        g.count === 1
          ? `${g.label} - playing area`
          : `${g.label} - playing area (x${g.count})`,
      imperial:
        g.count === 1
          ? `${ftv(g.l)} x ${ftv(g.w)} ft  =  ${nf(g.area)} sq.ft`
          : `${g.count} x ${ftv(g.l)} x ${ftv(g.w)} ft  =  ${nf(g.area)} sq.ft`,
      metric:
        g.count === 1
          ? `${mtv(g.l)} x ${mtv(g.w)} m  =  ${nf(g.area * SQFT_SQM)} sq.m`
          : `${g.count} x ${mtv(g.l)} x ${mtv(g.w)} m  =  ${nf(g.area * SQFT_SQM)} sq.m`,
    });
  }
  // Spacing between tiled courts, when the user set one.
  if (areas.courtGapFt && areas.courtGapFt > 0) {
    rows.push({
      label: "Distance between courts",
      imperial: `${ftv(areas.courtGapFt)} ft`,
      metric: `${mtv(areas.courtGapFt)} m`,
    });
  }
  const totalSqFt = areas.courtAreaSqFt + areas.nonPlayingSqFt;
  rows.push({
    label: "Non-playing (run-off)",
    imperial: `${nf(areas.nonPlayingSqFt)} sq.ft`,
    metric: `${nf(areas.nonPlayingSqFt * SQFT_SQM)} sq.m`,
  });
  rows.push({
    label: "Total area",
    imperial: `${nf(totalSqFt)} sq.ft`,
    metric: `${nf(totalSqFt * SQFT_SQM)} sq.m`,
  });

  const tableX = MARGIN;
  const tableW = CONTENT_W;
  const labelW = 160;
  const headH = 26;
  const rowH = 44;
  ensure(ctx, headH + rows.length * rowH + 10);

  // Header band
  ctx.page.drawRectangle({
    x: tableX,
    y: ctx.y - headH,
    width: tableW,
    height: headH,
    color: COL.ink,
  });
  ctx.page.drawText("Area", {
    x: tableX + 10,
    y: ctx.y - 17,
    size: 12,
    font: ctx.bold,
    color: rgb(1, 1, 1),
  });
  ctx.page.drawText("Size", {
    x: tableX + labelW + 10,
    y: ctx.y - 17,
    size: 12,
    font: ctx.bold,
    color: rgb(1, 1, 1),
  });
  ctx.y -= headH;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (i % 2 === 1) {
      ctx.page.drawRectangle({
        x: tableX,
        y: ctx.y - rowH,
        width: tableW,
        height: rowH,
        color: COL.band,
      });
    }
    ctx.page.drawRectangle({
      x: tableX,
      y: ctx.y - rowH,
      width: tableW,
      height: rowH,
      borderColor: COL.line,
      borderWidth: 0.75,
    });
    ctx.page.drawText(sanitize(r.label), {
      x: tableX + 10,
      y: ctx.y - rowH / 2 - 4,
      size: 12,
      font: ctx.bold,
      color: COL.ink,
    });
    ctx.page.drawText(sanitize(r.imperial), {
      x: tableX + labelW + 10,
      y: ctx.y - 18,
      size: 11.5,
      font: ctx.font,
      color: COL.ink,
    });
    ctx.page.drawText(sanitize(r.metric), {
      x: tableX + labelW + 10,
      y: ctx.y - 33,
      size: 10,
      font: ctx.font,
      color: COL.soft,
    });
    ctx.y -= rowH;
  }
}

// One large 3D drone still on its own page — sales asked for a single hero 3D
// image, not the multi-angle grid.
async function drawSingle3DView(ctx: Ctx, image: Uint8Array) {
  sectionTitle(ctx, "3D drone view");
  gap(ctx, 4);
  const img = await tryEmbed(ctx.doc, image);
  if (!img) {
    text(ctx, "(3D preview unavailable.)", { color: COL.faint, size: 9 });
    return;
  }
  const availW = CONTENT_W;
  const availH = ctx.y - MARGIN - 44;
  const scale = Math.min(availW / img.width, availH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.page.drawImage(img, {
    x: MARGIN + (availW - w) / 2,
    y: ctx.y - h - 6,
    width: w,
    height: h,
  });
  ctx.y -= h + 16;
  text(
    ctx,
    "A 6-second spinning 3D walkaround is sent to you as a separate WhatsApp video.",
    { color: COL.soft, size: 9.5 },
  );
}

// 3D turntable grid — the captured angle stills laid out 2-per-row so the
// customer sees the court from every side in the static document.
async function drawAngleGrid(ctx: Ctx, images: Uint8Array[]) {
  sectionTitle(ctx, "3D views — every angle");
  const cols = 2;
  const gapX = 10;
  const gapY = 10;
  const cellW = (CONTENT_W - gapX * (cols - 1)) / cols;
  const rows = Math.max(1, Math.ceil(images.length / cols));
  // Size the rows to fill the space left under the title — every captured
  // angle shares one full, balanced page instead of spilling a half-empty
  // second page.
  const availH = ctx.y - MARGIN - 18;
  const cellH = (availH - gapY * (rows - 1)) / rows;
  for (let i = 0; i < images.length; i += cols) {
    const rowTop = ctx.y;
    for (let c = 0; c < cols; c++) {
      const bytes = images[i + c];
      if (!bytes) break;
      const embedded = await tryEmbed(ctx.doc, bytes);
      if (!embedded) continue;
      const x = MARGIN + c * (cellW + gapX);
      const scale = Math.min(cellW / embedded.width, cellH / embedded.height);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      ctx.page.drawImage(embedded, {
        x: x + (cellW - w) / 2,
        y: rowTop - cellH + (cellH - h) / 2,
        width: w,
        height: h,
      });
    }
    ctx.y = rowTop - cellH - gapY;
  }
}

// Draw one image centred, scaled to the content width and a max height —
// used for the full-page 2D plan and the 3D video poster.
async function drawImageFit(ctx: Ctx, bytes: Uint8Array, maxH: number) {
  const embedded = await tryEmbed(ctx.doc, bytes);
  if (!embedded) {
    text(ctx, "(image could not be embedded)", { color: COL.faint, size: 9 });
    return;
  }
  const availH = Math.max(120, Math.min(maxH, ctx.y - MARGIN - 30));
  const scale = Math.min(CONTENT_W / embedded.width, availH / embedded.height);
  const w = embedded.width * scale;
  const h = embedded.height * scale;
  ctx.page.drawImage(embedded, {
    x: MARGIN + (CONTENT_W - w) / 2,
    y: ctx.y - h,
    width: w,
    height: h,
  });
  ctx.y -= h + 6;
}

// A dedicated "3D walkaround video" page — the poster still with a play
// badge, and a note that the actual video arrives as a WhatsApp message
// (a PDF can't play video).
async function drawVideoPage(ctx: Ctx, posterBytes: Uint8Array) {
  sectionTitle(ctx, "3D walkaround video");
  const embedded = await tryEmbed(ctx.doc, posterBytes);
  if (embedded) {
    const availH = ctx.y - MARGIN - 50;
    const scale = Math.min(CONTENT_W / embedded.width, availH / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    const x = MARGIN + (CONTENT_W - w) / 2;
    const y = ctx.y - h;
    ctx.page.drawImage(embedded, { x, y, width: w, height: h });
    // Play badge — a translucent dark disc with a white triangle.
    const bx = x + w / 2;
    const by = y + h / 2;
    ctx.page.drawCircle({ x: bx, y: by, size: 24, color: rgb(0, 0, 0), opacity: 0.5 });
    ctx.page.drawSvgPath("M 0 -11 L 0 11 L 16 0 Z", {
      x: bx - 4,
      y: by,
      color: rgb(1, 1, 1),
    });
    ctx.y = y - 10;
  }
  text(
    ctx,
    "A 6-second spinning 3D walkaround of this court is sent to you as a separate WhatsApp video.",
    { color: COL.soft, size: 9.5 },
  );
}

async function drawProduct(ctx: Ctx, p: ProductDTO) {
  ensure(ctx, 70);
  const startY = ctx.y;
  let textX = MARGIN;
  // Thumbnail on the left if embeddable.
  if (p.heroImageUrl) {
    const bytes = await fetchBytes(p.heroImageUrl);
    if (bytes) {
      const img = await tryEmbed(ctx.doc, bytes);
      if (img) {
        // Fit within a 56x56 box preserving aspect ratio, then centre —
        // catalogue hero photos are almost never square, so forcing them
        // to 56x56 visibly stretched/squished the flooring thumbnails.
        const box = 56;
        const scale = Math.min(box / img.width, box / img.height);
        const iw = img.width * scale;
        const ih = img.height * scale;
        ctx.page.drawImage(img, {
          x: MARGIN + (box - iw) / 2,
          y: startY - box + (box - ih) / 2,
          width: iw,
          height: ih,
        });
        textX = MARGIN + box + 10;
      }
    }
  }
  const w = PAGE_W - MARGIN - textX;
  ctx.page.drawText(sanitize(p.name), {
    x: textX,
    y: startY - 12,
    size: 10.5,
    font: ctx.bold,
    color: COL.ink,
  });
  let ly = startY - 26;
  if (p.priceInr != null) {
    ctx.page.drawText(
      sanitize(`Rs ${p.priceInr.toLocaleString("en-IN")}${p.unit ? ` / ${p.unit}` : ""}`),
      { x: textX, y: ly, size: 9, font: ctx.font, color: COL.soft },
    );
    ly -= 12;
  }
  // Catalogue products keep their spec sheet as a stack of HTML <table>s
  // inside the description (Product Information / Yarn / Backing / …).
  // Pull them all out so the summary text stays readable and each spec
  // group renders as its own titled table.
  const { tables, rest } = extractHtmlTables(p.description);
  const desc = rest.slice(0, 300);
  if (desc) {
    for (const line of wrap(ctx.font, sanitize(desc), 8.5, w)) {
      ctx.page.drawText(line, { x: textX, y: ly, size: 8.5, font: ctx.font, color: COL.soft });
      ly -= 11;
    }
  }
  ctx.y = Math.min(ly, startY - 62) - 6;

  // Prefer the structured specs JSON if it has real values; otherwise
  // render every table parsed out of the description HTML, each titled.
  const specEntries = Object.entries(p.specs).filter(
    ([, v]) => v && String(v).trim(),
  );
  if (specEntries.length > 0) {
    drawSpecTable(
      ctx,
      specEntries.map(([k, v]) => [
        k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(),
        String(v),
      ]),
    );
  } else {
    for (const t of tables) {
      if (t.title) {
        ensure(ctx, 16);
        gap(ctx, 4);
        ctx.page.drawText(sanitize(t.title), {
          x: MARGIN + 8,
          y: ctx.y - 10,
          size: 8.5,
          font: ctx.bold,
          color: COL.green,
        });
        ctx.y -= 14;
      }
      drawSpecTable(ctx, t.rows);
    }
  }
  gap(ctx, 6);
}

// Two-column spec table (Specification | Value) with a header band and
// row separators. Full content width, indented under the product.
function drawSpecTable(ctx: Ctx, entries: Array<[string, string]>) {
  const tableX = MARGIN + 8;
  const tableW = CONTENT_W - 8;
  const col1 = Math.round(tableW * 0.42);
  const rowH = 15;
  ensure(ctx, rowH * (entries.length + 1) + 6);

  // Header
  ctx.page.drawRectangle({
    x: tableX,
    y: ctx.y - rowH,
    width: tableW,
    height: rowH,
    color: COL.band,
  });
  ctx.page.drawText("Specification", {
    x: tableX + 5,
    y: ctx.y - rowH + 4,
    size: 8,
    font: ctx.bold,
    color: COL.ink,
  });
  ctx.page.drawText("Value", {
    x: tableX + col1 + 5,
    y: ctx.y - rowH + 4,
    size: 8,
    font: ctx.bold,
    color: COL.ink,
  });
  ctx.y -= rowH;

  for (const [k, v] of entries) {
    ensure(ctx, rowH);
    // Labels arrive already human-readable (from specs JSON mapping or
    // the parsed HTML table) — don't re-split camelCase here.
    const label = sanitize(k.trim());
    // Row border
    ctx.page.drawRectangle({
      x: tableX,
      y: ctx.y - rowH,
      width: tableW,
      height: rowH,
      borderColor: COL.line,
      borderWidth: 0.5,
    });
    ctx.page.drawText(label.slice(0, 40), {
      x: tableX + 5,
      y: ctx.y - rowH + 4,
      size: 8,
      font: ctx.font,
      color: COL.soft,
    });
    // Value — wrap/truncate to the column.
    const valLines = wrap(ctx.font, sanitize(String(v)), 8, tableW - col1 - 10);
    ctx.page.drawText(valLines[0] ?? "", {
      x: tableX + col1 + 5,
      y: ctx.y - rowH + 4,
      size: 8,
      font: ctx.font,
      color: COL.ink,
    });
    ctx.y -= rowH;
  }
}

// Full quotation block styled like the Fitoverse client quote sheet: a green
// header row (Service description | Total Area in Sq.ft | Price per sq.ft |
// Total Value), one gridded row per line item with the full description under
// the name, then the totals.
function drawQuote(ctx: Ctx, q: CombinedQuote) {
  sectionTitle(ctx, `Quotation ${q.number}`);
  if (q.title) text(ctx, q.title, { size: 10.5, bold: true });
  if (q.notes) text(ctx, q.notes, { size: 8.5, color: COL.soft });
  gap(ctx, 6);

  // Column edges.
  const x0 = MARGIN;
  const x1 = MARGIN + CONTENT_W * 0.5; // service description | area
  const x2 = MARGIN + CONTENT_W * 0.7; // area | price
  const x3 = MARGIN + CONTENT_W * 0.83; // price | total
  const xEnd = MARGIN + CONTENT_W;
  const padX = 6;

  const drawHeader = () => {
    const headerH = 26;
    ensure(ctx, headerH + 4);
    const top = ctx.y;
    ctx.page.drawRectangle({
      x: x0,
      y: top - headerH,
      width: CONTENT_W,
      height: headerH,
      color: COL.green,
    });
    const hcol = (s: string, xL: number, xR: number, center: boolean) => {
      const lines = wrap(ctx.bold, s, 8.5, xR - xL - padX * 2);
      let ty = top - 11 - (lines.length === 1 ? 3 : 0);
      for (const ln of lines) {
        const w = ctx.bold.widthOfTextAtSize(ln, 8.5);
        const tx = center ? (xL + xR) / 2 - w / 2 : xL + padX;
        ctx.page.drawText(ln, { x: tx, y: ty, size: 8.5, font: ctx.bold, color: rgb(1, 1, 1) });
        ty -= 10;
      }
    };
    hcol("Service description", x0, x1, false);
    hcol("Total Area in Sq.ft", x1, x2, true);
    hcol("Price per sq.ft", x2, x3, true);
    hcol("Total Value", x3, xEnd, true);
    ctx.y = top - headerH;
  };

  drawHeader();

  for (const it of q.items) {
    const descMax = x1 - x0 - padX * 2;
    const nameLines = wrap(ctx.bold, sanitize(it.name), 8.5, descMax);
    const descLines = it.desc ? wrap(ctx.font, sanitize(it.desc), 7.5, descMax) : [];
    const contentH =
      8 + nameLines.length * 10 + (descLines.length ? 2 + descLines.length * 9 : 0) + 4;
    const rowH = Math.max(22, contentH);

    // Keep the row whole; repeat the header when it spills to a new page.
    if (ctx.y - rowH < MARGIN + 36) {
      newPage(ctx);
      sectionTitle(ctx, `Quotation ${q.number} (continued)`);
      drawHeader();
    }
    const top = ctx.y;

    // Service description — name (bold) then the full wrapped description.
    let ty = top - 12;
    for (const ln of nameLines) {
      ctx.page.drawText(ln, { x: x0 + padX, y: ty, size: 8.5, font: ctx.bold, color: COL.ink });
      ty -= 10;
    }
    if (descLines.length) {
      ty -= 2;
      for (const ln of descLines) {
        ctx.page.drawText(ln, { x: x0 + padX, y: ty, size: 7.5, font: ctx.font, color: COL.soft });
        ty -= 9;
      }
    }

    // Area / price / total, right-aligned in their columns.
    const rcell = (s: string, xR: number, bold = false) => {
      const f = bold ? ctx.bold : ctx.font;
      const w = f.widthOfTextAtSize(sanitize(s), 8.5);
      ctx.page.drawText(sanitize(s), {
        x: xR - padX - w,
        y: top - 12,
        size: 8.5,
        font: f,
        color: COL.ink,
      });
    };
    const areaStr =
      it.qty != null
        ? `${Math.round(it.qty).toLocaleString("en-IN")}${it.unit ? ` ${it.unit}` : ""}`
        : "-";
    rcell(areaStr, x2);
    rcell(it.rate != null ? it.rate.toLocaleString("en-IN") : "-", x3);
    rcell(`Rs ${it.total.toLocaleString("en-IN")}`, xEnd, true);

    // Grid: row bottom border + column separators.
    ctx.page.drawLine({
      start: { x: x0, y: top - rowH },
      end: { x: xEnd, y: top - rowH },
      thickness: 0.5,
      color: COL.line,
    });
    for (const vx of [x0, x1, x2, x3, xEnd]) {
      ctx.page.drawLine({
        start: { x: vx, y: top },
        end: { x: vx, y: top - rowH },
        thickness: 0.5,
        color: COL.line,
      });
    }
    ctx.y = top - rowH;
  }

  gap(ctx, 6);
  drawTotalLine(ctx, "Subtotal", q.subtotal);
  drawTotalLine(ctx, "GST", q.gst);
  drawTotalLine(ctx, "Grand total", q.grandTotal, true);
}

function drawTotalLine(ctx: Ctx, label: string, val: number, strong = false) {
  ensure(ctx, 14);
  const f = strong ? ctx.bold : ctx.font;
  ctx.page.drawText(sanitize(label), { x: PAGE_W - MARGIN - 200, y: ctx.y - 10, size: 9.5, font: f, color: COL.ink });
  const v = `Rs ${val.toLocaleString("en-IN")}`;
  ctx.page.drawText(v, {
    x: PAGE_W - MARGIN - f.widthOfTextAtSize(v, 9.5),
    y: ctx.y - 10,
    size: 9.5,
    font: f,
    color: strong ? COL.green : COL.ink,
  });
  ctx.y -= 15;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
