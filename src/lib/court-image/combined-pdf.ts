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
import { htmlToPlainText } from "@/lib/products/format";
import type { ProductDTO, TdsDTO } from "@/lib/products/store";

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
  items: Array<{ name: string; total: number }>;
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
  // Design renders (2D plan, 3D image) as raw image bytes + format.
  designImages: Array<{ label: string; bytes: Uint8Array }>;
  products: ProductDTO[];
  equipment: ProductDTO[];
  tds: TdsDTO[];
  quote?: CombinedQuote | null;
  // Public interactive 3D viewer link — printed on the cover so the
  // customer can open it and rotate the court.
  viewer3dUrl?: string | null;
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
    .replace(/[^\x00-\xFF]/g, "");
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
  if (input.viewer3dUrl) {
    gap(ctx, 4);
    text(ctx, "Rotate the design in 3D (open on your phone):", {
      size: 9,
      bold: true,
      color: COL.green,
    });
    text(ctx, input.viewer3dUrl, { size: 8.5, color: COL.soft });
  }

  // ── Design images ──
  for (const img of input.designImages) {
    sectionTitle(ctx, img.label);
    const embedded = await tryEmbed(doc, img.bytes);
    if (embedded) {
      const scale = Math.min(CONTENT_W / embedded.width, 300 / embedded.height);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      ensure(ctx, h + 8);
      ctx.page.drawImage(embedded, {
        x: MARGIN,
        y: ctx.y - h,
        width: w,
        height: h,
      });
      ctx.y -= h + 6;
    } else {
      text(ctx, "(image could not be embedded)", { color: COL.faint, size: 9 });
    }
  }

  // ── Products ──
  if (input.products.length > 0) {
    sectionTitle(ctx, "Flooring & materials");
    for (const p of input.products) await drawProduct(ctx, p);
  }

  // ── Equipment ──
  if (input.equipment.length > 0) {
    sectionTitle(ctx, "Sports equipment");
    for (const p of input.equipment) await drawProduct(ctx, p);
  }

  // ── TDS ──
  if (input.tds.length > 0) {
    sectionTitle(ctx, "Technical data sheets (TDS)");
    for (const t of input.tds) {
      ensure(ctx, 16);
      text(ctx, `- ${t.name}`, { size: 9.5 });
      if (t.url) text(ctx, `  ${t.url}`, { size: 8, color: COL.faint });
    }
  }

  // ── Quote (optional) ──
  if (input.quote) {
    sectionTitle(ctx, `Quotation ${input.quote.number}`);
    for (const it of input.quote.items) {
      ensure(ctx, 14);
      const label = sanitize(it.name);
      const val = `Rs ${it.total.toLocaleString("en-IN")}`;
      ctx.page.drawText(label.slice(0, 60), {
        x: MARGIN,
        y: ctx.y - 10,
        size: 9,
        font,
        color: COL.ink,
      });
      ctx.page.drawText(val, {
        x: PAGE_W - MARGIN - font.widthOfTextAtSize(val, 9),
        y: ctx.y - 10,
        size: 9,
        font,
        color: COL.ink,
      });
      ctx.y -= 14;
    }
    gap(ctx, 4);
    drawTotalLine(ctx, "Subtotal", input.quote.subtotal);
    drawTotalLine(ctx, "GST", input.quote.gst);
    drawTotalLine(ctx, "Grand total", input.quote.grandTotal, true);
  }

  // ── Footer on every page ──
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
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
        const size = 56;
        ctx.page.drawImage(img, {
          x: MARGIN,
          y: startY - size,
          width: size,
          height: size,
        });
        textX = MARGIN + size + 10;
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
  const desc = htmlToPlainText(p.description).slice(0, 220);
  if (desc) {
    for (const line of wrap(ctx.font, sanitize(desc), 8.5, w)) {
      ctx.page.drawText(line, { x: textX, y: ly, size: 8.5, font: ctx.font, color: COL.soft });
      ly -= 11;
    }
  }
  ctx.y = Math.min(ly, startY - 62) - 6;

  // Spec table — key/value rows in a clean 2-column table.
  const specEntries = Object.entries(p.specs).filter(
    ([, v]) => v && String(v).trim(),
  );
  if (specEntries.length > 0) {
    drawSpecTable(ctx, specEntries);
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
    const label = sanitize(
      k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(),
    );
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
