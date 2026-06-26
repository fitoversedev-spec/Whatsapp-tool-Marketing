// Quotation PDF renderer built on pdf-lib (pure JS, no native deps, uses the
// PDF spec's standard fonts so there are no font files to read at runtime).
//
// We switched from @react-pdf/renderer because react-pdf does dynamic ESM
// imports per render. On a Windows machine where the project lives under a
// OneDrive-synced folder, OneDrive briefly locks node_modules files, and
// the ESM loader's synchronous readFileSync surfaces as
// `Error: UNKNOWN: unknown error, read` (errno -4094). pdf-lib has no such
// runtime imports, so it works regardless of OneDrive state.
//
// Trade-off: pdf-lib is imperative (we position every text element manually)
// vs. react-pdf's React-style layout. For our use case (a multi-page
// quotation with tables) the imperative API is fine; helper functions below
// keep the call site readable.

import {
  PDFDocument,
  StandardFonts,
  rgb,
  PageSizes,
  PDFFont,
  PDFPage,
  PDFImage,
  PDFString,
  PDFName,
} from "pdf-lib";
import type { QuoteLineItem } from "./calculator";
import fs from "fs";
import path from "path";

// Read the Fitoverse logo from /public once at module load. Wrapped in
// try/catch so a missing or unreadable file degrades the PDF gracefully
// (text-only brand header) rather than failing the whole render. /public
// files live outside node_modules so OneDrive sync lock isn't a concern
// here the way it is for npm packages.
let LOGO_BYTES: Buffer | null = null;
try {
  LOGO_BYTES = fs.readFileSync(
    path.join(process.cwd(), "public", "quotation-assets", "image1.png")
  );
} catch {
  LOGO_BYTES = null;
}

const PAGE_W = PageSizes.A4[0]; // 595.28
const PAGE_H = PageSizes.A4[1]; // 841.89
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_RESERVE = 30;

// Polished palette — more contrast on titles, softer borders, dedicated
// link colour. The two-tone accent (deep + soft) lets us layer cards and
// dividers without everything looking flat.
const COL = {
  text: rgb(0.07, 0.09, 0.15),
  textSoft: rgb(0.22, 0.27, 0.35),
  muted: rgb(0.45, 0.5, 0.58),
  accent: rgb(0.027, 0.369, 0.329), // #075E54 — Fitoverse dark green
  accentSoft: rgb(0.86, 0.94, 0.91), // pale teal for card highlights
  accentText: rgb(1, 1, 1),
  light: rgb(0.96, 0.97, 0.99),
  border: rgb(0.88, 0.9, 0.93),
  borderStrong: rgb(0.78, 0.81, 0.85),
  rowAlt: rgb(0.98, 0.985, 0.99),
  green: rgb(0.86, 0.97, 0.78), // #DCF8C6
  grandTotalBg: rgb(0.027, 0.369, 0.329),
  link: rgb(0.09, 0.4, 0.75), // standard link blue
};

function inr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// pdf-lib's built-in Helvetica fonts use the WinAnsi character set, which
// excludes any Unicode beyond Western European glyphs. Anything outside the
// set throws "WinAnsi cannot encode" at draw time. We pre-replace the
// characters that real quotations actually contain (rupee, math operators,
// arrows, ellipsis, smart quotes) with WinAnsi-safe equivalents, then strip
// any remaining unsupported codepoints to avoid mid-render failures.
const SAFE_REPLACEMENTS: Record<string, string> = {
  "₹": "Rs.", // ₹ Indian Rupee → Rs. (industry standard fallback)
  "≥": ">=", // ≥
  "≤": "<=", // ≤
  "≠": "!=", // ≠
  "…": "...", // …
  "→": "->", // →
  "←": "<-", // ←
  "—": "-", // — em dash (technically in WinAnsi but inconsistent)
  "–": "-", // – en dash
  "‘": "'", // ' left single quote
  "’": "'", // ' right single quote / apostrophe
  "“": '"', // " left double quote
  "”": '"', // " right double quote
  " ": " ", // non-breaking space
  "•": "-", // • bullet — we draw our own bullet glyph
};
function sanitize(text: string): string {
  if (!text) return "";
  let out = text;
  for (const [from, to] of Object.entries(SAFE_REPLACEMENTS)) {
    out = out.split(from).join(to);
  }
  // Drop any remaining codepoints WinAnsi can't render (emojis, CJK, etc.).
  // 0x00–0xFF covers everything Helvetica's WinAnsi knows about.
  out = out.replace(/[^\x00-\xFF]/g, "");
  return out;
}

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number; // current cursor — distance from TOP of page (we convert to pdf-y on draw)
  quoteNumber: string;
  pageNumber: number;
};

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage(PageSizes.A4);
  ctx.y = MARGIN;
  ctx.pageNumber += 1;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y + needed > PAGE_H - MARGIN - FOOTER_RESERVE) {
    drawFooter(ctx);
    newPage(ctx);
  }
}

function yFromTop(top: number): number {
  return PAGE_H - top;
}

function drawText(
  ctx: Ctx,
  rawText: string,
  opts: {
    x: number;
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    align?: "left" | "right" | "center";
    maxWidth?: number;
  }
): number {
  const text = sanitize(rawText);
  const size = opts.size ?? 9;
  const font = opts.bold ? ctx.bold : ctx.font;
  const color = opts.color ?? COL.text;
  const lineHeight = size * 1.35;

  // Word wrap if maxWidth provided
  const lines: string[] = [];
  if (opts.maxWidth) {
    const words = text.split(/\s+/);
    let current = "";
    for (const w of words) {
      const trial = current ? `${current} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > opts.maxWidth) {
        if (current) lines.push(current);
        current = w;
      } else {
        current = trial;
      }
    }
    if (current) lines.push(current);
    if (lines.length === 0) lines.push("");
  } else {
    lines.push(text);
  }

  for (const line of lines) {
    ensureSpace(ctx, lineHeight);
    const w = font.widthOfTextAtSize(line, size);
    let x = opts.x;
    if (opts.align === "right" && opts.maxWidth) x = opts.x + opts.maxWidth - w;
    if (opts.align === "center" && opts.maxWidth) x = opts.x + (opts.maxWidth - w) / 2;
    safeDraw(ctx.page, line, {
      x,
      y: yFromTop(ctx.y + size),
      size,
      font,
      color,
    });
    ctx.y += lineHeight;
  }
  return lines.length * lineHeight;
}

function drawRect(
  ctx: Ctx,
  x: number,
  yTop: number,
  w: number,
  h: number,
  opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; borderWidth?: number } = {}
) {
  ctx.page.drawRectangle({
    x,
    y: yFromTop(yTop + h),
    width: w,
    height: h,
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.borderWidth ?? (opts.border ? 0.5 : 0),
  });
}

function drawLine(ctx: Ctx, x1: number, x2: number, color = COL.border, thickness = 0.5) {
  const y = yFromTop(ctx.y);
  ctx.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, color, thickness });
}

function space(ctx: Ctx, n = 8) {
  ctx.y += n;
}

function drawFooter(ctx: Ctx) {
  const y = PAGE_H - 20;
  ctx.page.drawLine({
    start: { x: MARGIN, y: y + 12 },
    end: { x: PAGE_W - MARGIN, y: y + 12 },
    color: COL.border,
    thickness: 0.5,
  });
  safeDraw(ctx.page, 
    `FITOVERSE PRIVATE LIMITED  |  ${ctx.quoteNumber}  |  Page ${ctx.pageNumber}`,
    {
      x: MARGIN,
      y,
      size: 7,
      font: ctx.font,
      color: COL.muted,
    }
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function drawHeader(ctx: Ctx, _customerName: string, logoImage: PDFImage | null) {
  // Brand band
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, 50, { fill: COL.accent });

  // Logo (left-aligned). If embed succeeded we draw it inset on the band;
  // text shifts right to make room. If no logo, text starts at the band's
  // left edge as before.
  const LOGO_BOX = 40;
  const LOGO_PAD = 6;
  let textStartX = MARGIN + 12;
  if (logoImage) {
    const fitted = logoImage.scaleToFit(LOGO_BOX, LOGO_BOX);
    // Center logo vertically inside the 50px band
    ctx.page.drawImage(logoImage, {
      x: MARGIN + LOGO_PAD,
      y: yFromTop(ctx.y + 50 - (50 - fitted.height) / 2),
      width: fitted.width,
      height: fitted.height,
    });
    textStartX = MARGIN + LOGO_PAD + LOGO_BOX + 10;
  }

  safeDraw(ctx.page, "FITOVERSE PRIVATE LIMITED", {
    x: textStartX,
    y: yFromTop(ctx.y + 18),
    size: 14,
    font: ctx.bold,
    color: COL.accentText,
  });
  safeDraw(ctx.page, "Sports Infrastructure  ·  Turnkey Solutions", {
    x: textStartX,
    y: yFromTop(ctx.y + 32),
    size: 9,
    font: ctx.font,
    color: COL.accentText,
  });
  safeDraw(ctx.page, "+91 63815 02055  ·  fitoverse.com", {
    x: textStartX,
    y: yFromTop(ctx.y + 44),
    size: 8,
    font: ctx.font,
    color: COL.accentText,
  });
  // Right-aligned CIN/GST
  const rightX = PAGE_W - MARGIN - 12;
  const cinText = "CIN: U92490TZ2022PTC038004";
  const gstText = "GSTIN: 33AAECF8905G1ZQ";
  safeDraw(ctx.page, cinText, {
    x: rightX - safeWidth(ctx.font, cinText, 8),
    y: yFromTop(ctx.y + 32),
    size: 8,
    font: ctx.font,
    color: COL.accentText,
  });
  safeDraw(ctx.page, gstText, {
    x: rightX - safeWidth(ctx.font, gstText, 8),
    y: yFromTop(ctx.y + 44),
    size: 8,
    font: ctx.font,
    color: COL.accentText,
  });
  ctx.y += 60;
}

function drawTitle(ctx: Ctx, sport: string) {
  space(ctx, 4);
  const t = `Quotation for ${sport.charAt(0).toUpperCase() + sport.slice(1)} Turf Turnkey Solutions`;
  drawText(ctx, t, {
    x: MARGIN,
    size: 16,
    bold: true,
    align: "center",
    maxWidth: CONTENT_W,
    color: COL.accent,
  });
  // Decorative underline centered under the title
  const titleWidth = safeWidth(ctx.bold, t, 16);
  const lineY = yFromTop(ctx.y);
  const lineW = Math.min(titleWidth + 40, CONTENT_W - 80);
  const lineX = (PAGE_W - lineW) / 2;
  ctx.page.drawLine({
    start: { x: lineX, y: lineY + 2 },
    end: { x: lineX + lineW, y: lineY + 2 },
    color: COL.accent,
    thickness: 1.2,
  });
  space(ctx, 10);
}

function drawInfoGrid(
  ctx: Ctx,
  number: string,
  customerName: string,
  quoteDate: string,
  lengthFt: number,
  widthFt: number
) {
  // Two rows (validity intentionally not shown on PDF — user request).
  const blockH = 50;
  ensureSpace(ctx, blockH);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, blockH, { fill: COL.light });

  const colW = CONTENT_W / 2;
  const fields: { label: string; value: string; col: 0 | 1; row: 0 | 1 }[] = [
    { label: "QUOTATION #", value: number, col: 0, row: 0 },
    { label: "QUOTED ON", value: quoteDate, col: 1, row: 0 },
    { label: "TO", value: customerName, col: 0, row: 1 },
    {
      label: "PLOT DIMENSIONS",
      value: `${lengthFt} × ${widthFt} ft = ${inr(lengthFt * widthFt)} sq.ft`,
      col: 1,
      row: 1,
    },
  ];
  const rowH = 22;
  for (const f of fields) {
    const x = MARGIN + 12 + f.col * colW;
    const yTop = ctx.y + 8 + f.row * rowH;
    safeDraw(ctx.page, f.label, {
      x,
      y: yFromTop(yTop + 8),
      size: 7,
      font: ctx.bold,
      color: COL.muted,
    });
    safeDraw(ctx.page, f.value, {
      x,
      y: yFromTop(yTop + 19),
      size: 10,
      font: ctx.font,
      color: COL.text,
    });
  }
  ctx.y += blockH;
  space(ctx, 8);
}

function drawItemsTable(ctx: Ctx, items: QuoteLineItem[]) {
  const cols = {
    desc: 290,
    area: 65,
    rate: 65,
    total: 103,
  };
  const colXs = {
    desc: MARGIN,
    area: MARGIN + cols.desc,
    rate: MARGIN + cols.desc + cols.area,
    total: MARGIN + cols.desc + cols.area + cols.rate,
  };
  const headerH = 22;

  // Header row
  ensureSpace(ctx, headerH);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, headerH, { fill: COL.accent });
  const headerY = yFromTop(ctx.y + 15);
  safeDraw(ctx.page, "Service Description", {
    x: colXs.desc + 6,
    y: headerY,
    size: 9,
    font: ctx.bold,
    color: COL.accentText,
  });
  const writeHeaderRight = (text: string, colX: number, colW: number) => {
    const w = safeWidth(ctx.bold, text, 9);
    safeDraw(ctx.page, text, {
      x: colX + colW - w - 6,
      y: headerY,
      size: 9,
      font: ctx.bold,
      color: COL.accentText,
    });
  };
  writeHeaderRight("Area", colXs.area, cols.area);
  writeHeaderRight("Rate ₹", colXs.rate, cols.rate);
  writeHeaderRight("Total ₹", colXs.total, cols.total);
  ctx.y += headerH;

  // Body rows
  let rowIdx = 0;
  for (const item of items) {
    if (!item.included) continue;

    // Estimate row height
    const descLines = wordWrap(ctx.font, item.description, 9, cols.desc - 12);
    const rowH = 10 + 14 + descLines.length * 12 + 12 + 10; // name + desc + gst tag + pads
    ensureSpace(ctx, rowH);
    if (rowIdx % 2 === 1) drawRect(ctx, MARGIN, ctx.y, CONTENT_W, rowH, { fill: COL.rowAlt });

    const startY = ctx.y + 8;
    // Item name (bold)
    safeDraw(ctx.page, item.name, {
      x: colXs.desc + 6,
      y: yFromTop(startY + 9),
      size: 10,
      font: ctx.bold,
      color: COL.text,
    });
    // Description (wrapped)
    let descY = startY + 22;
    for (const line of descLines) {
      safeDraw(ctx.page, line, {
        x: colXs.desc + 6,
        y: yFromTop(descY + 8),
        size: 8,
        font: ctx.font,
        color: COL.muted,
      });
      descY += 12;
    }
    // GST tag
    safeDraw(ctx.page, `(GST ${item.gstPercent}%)`, {
      x: colXs.desc + 6,
      y: yFromTop(descY + 8),
      size: 7,
      font: ctx.font,
      color: COL.muted,
    });

    // Right-aligned numbers
    const drawNum = (text: string, colX: number, colW: number) => {
      const w = safeWidth(ctx.font, text, 9);
      safeDraw(ctx.page, text, {
        x: colX + colW - w - 6,
        y: yFromTop(startY + 9),
        size: 9,
        font: ctx.font,
        color: COL.text,
      });
    };
    drawNum(inr(item.areaSqFt), colXs.area, cols.area);
    drawNum(inr(item.ratePerSqFt), colXs.rate, cols.rate);
    drawNum(inr(item.areaSqFt * item.ratePerSqFt), colXs.total, cols.total);

    // Bottom border
    ctx.page.drawLine({
      start: { x: MARGIN, y: yFromTop(ctx.y + rowH) },
      end: { x: PAGE_W - MARGIN, y: yFromTop(ctx.y + rowH) },
      color: COL.border,
      thickness: 0.5,
    });

    ctx.y += rowH;
    rowIdx++;
  }
  // Outer border for the whole table area
  // (drawn last so it overlays cleanly; trivial approximation)
  space(ctx, 4);
}

function drawTotals(ctx: Ctx, subtotal: number, gst: number, grandTotal: number) {
  const totalsW = 240;
  const x = PAGE_W - MARGIN - totalsW;
  const lineH = 16;
  ensureSpace(ctx, lineH * 4 + 16);

  const drawTotalRow = (label: string, value: string, bold = false) => {
    const font = bold ? ctx.bold : ctx.font;
    safeDraw(ctx.page, label, {
      x,
      y: yFromTop(ctx.y + 11),
      size: 10,
      font,
      color: COL.text,
    });
    const valW = safeWidth(font, value, 10);
    safeDraw(ctx.page, value, {
      x: PAGE_W - MARGIN - valW,
      y: yFromTop(ctx.y + 11),
      size: 10,
      font: ctx.bold,
      color: COL.text,
    });
    ctx.y += lineH;
  };

  drawTotalRow("Subtotal (without GST)", `₹ ${inr(subtotal)}`);
  drawTotalRow("GST Amount", `₹ ${inr(gst)}`);
  space(ctx, 4);

  // Grand total band
  drawRect(ctx, x, ctx.y, totalsW, 24, { fill: COL.grandTotalBg });
  safeDraw(ctx.page, "Grand Total", {
    x: x + 10,
    y: yFromTop(ctx.y + 16),
    size: 11,
    font: ctx.bold,
    color: COL.accentText,
  });
  const grandText = `₹ ${inr(grandTotal)}`;
  const grandW = safeWidth(ctx.bold, grandText, 11);
  safeDraw(ctx.page, grandText, {
    x: PAGE_W - MARGIN - grandW - 10,
    y: yFromTop(ctx.y + 16),
    size: 11,
    font: ctx.bold,
    color: COL.accentText,
  });
  ctx.y += 28;
}

function drawSectionTitle(ctx: Ctx, title: string) {
  space(ctx, 10);
  ensureSpace(ctx, 24);
  // Coloured accent bar on the left + larger title for better visual rhythm
  drawRect(ctx, MARGIN, ctx.y + 1, 3, 14, { fill: COL.accent });
  safeDraw(ctx.page, title, {
    x: MARGIN + 10,
    y: yFromTop(ctx.y + 12),
    size: 12,
    font: ctx.bold,
    color: COL.accent,
  });
  ctx.y += 18;
  drawLine(ctx, MARGIN, PAGE_W - MARGIN, COL.border, 0.5);
  space(ctx, 6);
}

// Draw a clickable URL link. Underlines the text in link blue + registers
// a Link annotation over the rendered text so PDF viewers turn it into
// a real hyperlink.
function drawLink(
  ctx: Ctx,
  label: string,
  url: string,
  opts: {
    x: number;
    y?: number; // top-cursor y; defaults to current ctx.y
    size?: number;
  }
): { width: number; height: number } {
  const size = opts.size ?? 10;
  const text = sanitize(label);
  const lineHeight = size * 1.4;
  const y = opts.y ?? ctx.y;

  ensureSpace(ctx, lineHeight);
  const textW = ctx.font.widthOfTextAtSize(text, size);
  const baselineY = yFromTop(y + size);
  // Underline
  ctx.page.drawLine({
    start: { x: opts.x, y: baselineY - 1 },
    end: { x: opts.x + textW, y: baselineY - 1 },
    color: COL.link,
    thickness: 0.6,
  });
  // Text
  ctx.page.drawText(text, {
    x: opts.x,
    y: baselineY,
    size,
    font: ctx.font,
    color: COL.link,
  });
  // Link annotation (clickable rectangle over the text)
  const annot = ctx.doc.context.register(
    ctx.doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [opts.x, baselineY - 2, opts.x + textW, baselineY + size],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(url),
      },
    })
  );
  const existing = ctx.page.node.get(PDFName.of("Annots"));
  if (existing && "push" in (existing as any)) {
    (existing as any).push(annot);
  } else {
    ctx.page.node.set(PDFName.of("Annots"), ctx.doc.context.obj([annot]));
  }
  return { width: textW, height: lineHeight };
}

// Render the Connect-with-Fitoverse card: a panel with clickable URLs.
function drawConnectSection(ctx: Ctx) {
  drawSectionTitle(ctx, "Connect with Fitoverse");

  const links: { label: string; url: string }[] = [
    { label: "Website", url: "https://fitoverse.com/" },
    { label: "Instagram", url: "https://www.instagram.com/fito.verse/" },
    {
      label: "Facebook",
      url: "https://www.facebook.com/profile.php?id=100077279349300",
    },
    { label: "Twitter (X)", url: "https://x.com/fitoverse" },
  ];

  const blockH = links.length * 20 + 18;
  ensureSpace(ctx, blockH);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, blockH, {
    fill: COL.accentSoft,
  });

  const startY = ctx.y + 10;
  links.forEach((link, i) => {
    const rowY = startY + i * 20;
    // Label (bold)
    safeDraw(ctx.page, `${link.label}:`, {
      x: MARGIN + 14,
      y: yFromTop(rowY + 10),
      size: 10,
      font: ctx.bold,
      color: COL.accent,
    });
    // Clickable URL
    drawLink(ctx, link.url, link.url, {
      x: MARGIN + 110,
      y: rowY,
      size: 10,
    });
  });
  ctx.y += blockH;
}

function drawBullets(ctx: Ctx, lines: string[]) {
  for (const line of lines) {
    const wrapped = wordWrap(ctx.font, line, 9, CONTENT_W - 18);
    ensureSpace(ctx, wrapped.length * 12 + 2);
    // Bullet
    safeDraw(ctx.page, "•", {
      x: MARGIN + 6,
      y: yFromTop(ctx.y + 8),
      size: 9,
      font: ctx.font,
      color: COL.text,
    });
    // Text
    let lineY = ctx.y;
    for (const w of wrapped) {
      safeDraw(ctx.page, w, {
        x: MARGIN + 18,
        y: yFromTop(lineY + 8),
        size: 9,
        font: ctx.font,
        color: COL.text,
      });
      lineY += 12;
    }
    ctx.y = lineY + 2;
  }
}

function drawTerm(ctx: Ctx, title: string, body: string) {
  ensureSpace(ctx, 16);
  drawText(ctx, title, { x: MARGIN, size: 9, bold: true });
  drawText(ctx, body, { x: MARGIN, size: 8, maxWidth: CONTENT_W, color: rgb(0.22, 0.25, 0.31) });
  space(ctx, 4);
}

function drawBankBlock(ctx: Ctx) {
  const blockH = 75;
  ensureSpace(ctx, blockH);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, blockH, { fill: COL.green });
  const startY = ctx.y + 8;
  const rows = [
    ["Account Name", "FITOVERSE PVT LTD"],
    ["Bank Name", "HDFC BANK"],
    ["Branch", "BRINDHAVAN ROAD"],
    ["Account No", "50200066429411"],
    ["IFSC", "HDFC0001281"],
  ];
  rows.forEach(([label, value], i) => {
    const yTop = startY + i * 13;
    safeDraw(ctx.page, `${label}:`, {
      x: MARGIN + 12,
      y: yFromTop(yTop + 9),
      size: 9,
      font: ctx.bold,
      color: COL.text,
    });
    safeDraw(ctx.page, value, {
      x: MARGIN + 110,
      y: yFromTop(yTop + 9),
      size: 9,
      font: ctx.font,
      color: COL.text,
    });
  });
  ctx.y += blockH + 4;
}

function drawSignatures(ctx: Ctx, customerName: string) {
  space(ctx, 24);
  ensureSpace(ctx, 80);
  const colW = CONTENT_W / 2 - 10;
  const startY = ctx.y;

  // Left
  safeDraw(ctx.page, "For FITOVERSE PRIVATE LIMITED", {
    x: MARGIN,
    y: yFromTop(startY + 10),
    size: 10,
    font: ctx.bold,
    color: COL.text,
  });
  ctx.page.drawLine({
    start: { x: MARGIN, y: yFromTop(startY + 50) },
    end: { x: MARGIN + colW, y: yFromTop(startY + 50) },
    color: COL.border,
    thickness: 0.5,
  });
  safeDraw(ctx.page, "Vignesh Manikandan", {
    x: MARGIN,
    y: yFromTop(startY + 62),
    size: 10,
    font: ctx.bold,
    color: COL.text,
  });
  safeDraw(ctx.page, "Director", {
    x: MARGIN,
    y: yFromTop(startY + 74),
    size: 9,
    font: ctx.font,
    color: COL.muted,
  });

  // Right
  const rightX = MARGIN + colW + 20;
  safeDraw(ctx.page, "Accepted & Agreed", {
    x: rightX,
    y: yFromTop(startY + 10),
    size: 10,
    font: ctx.bold,
    color: COL.text,
  });
  ctx.page.drawLine({
    start: { x: rightX, y: yFromTop(startY + 50) },
    end: { x: rightX + colW, y: yFromTop(startY + 50) },
    color: COL.border,
    thickness: 0.5,
  });
  safeDraw(ctx.page, `For ${customerName}`, {
    x: rightX,
    y: yFromTop(startY + 62),
    size: 10,
    font: ctx.font,
    color: COL.text,
  });
  safeDraw(ctx.page, "(Signature)", {
    x: rightX,
    y: yFromTop(startY + 74),
    size: 9,
    font: ctx.font,
    color: COL.muted,
  });
  ctx.y = startY + 84;
}

function wordWrap(font: PDFFont, rawText: string, size: number, maxWidth: number): string[] {
  const text = sanitize(rawText);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push("");
  return lines;
}

// Direct page.drawText() callers below also need sanitize() — the helper
// drawText/wordWrap functions above handle their inputs, but the imperative
// page.drawText() spots in drawHeader/drawInfoGrid/drawItemsTable/etc don't
// go through them. Use safeDraw() as a thin wrapper that auto-sanitizes.
function safeDraw(
  page: PDFPage,
  rawText: string,
  opts: Parameters<PDFPage["drawText"]>[1]
) {
  page.drawText(sanitize(rawText), opts);
}

// Compute width with sanitization, matching what we'll actually draw.
function safeWidth(font: PDFFont, rawText: string, size: number): number {
  return font.widthOfTextAtSize(sanitize(rawText), size);
}

// ─── Public entry point ─────────────────────────────────────────────────────

export type QuotationPdfData = {
  number: string;
  customerName: string;
  sport: string;
  lengthFt: number;
  widthFt: number;
  lineItems: QuoteLineItem[];
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
  notes?: string | null;
  quoteDate: Date;
  validityDays: number;
};

export async function renderQuotationPdf(data: QuotationPdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation ${data.number}`);
  doc.setAuthor("Fitoverse Private Limited");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Embed logo once — reused across all 3 pages' footers/headers. Null if
  // /public file was missing or embed failed (graceful text-only fallback).
  let logoImage: PDFImage | null = null;
  if (LOGO_BYTES) {
    try {
      logoImage = await doc.embedPng(LOGO_BYTES);
    } catch {
      logoImage = null;
    }
  }

  const ctx: Ctx = {
    doc,
    page: doc.addPage(PageSizes.A4),
    font,
    bold,
    y: MARGIN,
    quoteNumber: data.number,
    pageNumber: 1,
  };

  // ── PAGE 1: header, line items, totals, notes ──
  drawHeader(ctx, data.customerName, logoImage);
  drawTitle(ctx, data.sport);
  drawInfoGrid(
    ctx,
    data.number,
    data.customerName,
    data.quoteDate.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    data.lengthFt,
    data.widthFt
  );
  drawItemsTable(ctx, data.lineItems);
  drawTotals(ctx, data.subtotal, data.gstAmount, data.grandTotal);

  drawSectionTitle(ctx, "Notes");
  drawBullets(ctx, [
    "Installation charges are included in the above rates.",
    "GST is included in the above rates.",
    "Freight charges extra for materials at actuals.",
    "Client's scope: Leveled ground to be provided.",
    "Food and stay for installation team on client scope.",
    "Transport for goods on client scope.",
    "The padding cost is not included in the initial bill. It will be added once we visit the site and assess the requirements.",
  ]);

  if (data.notes && data.notes.trim()) {
    drawSectionTitle(ctx, "Additional Notes");
    drawText(ctx, data.notes.trim(), { x: MARGIN, size: 9, maxWidth: CONTENT_W });
  }

  drawFooter(ctx);
  newPage(ctx);

  // ── PAGE 2: payment terms, bank, advantage ──
  drawSectionTitle(ctx, "Payment Terms");
  drawBullets(ctx, [
    "50% advance during purchase order.",
    "30% during flooring work.",
    "15% after installation of basketball poles.",
    "5% after completion of work.",
  ]);
  space(ctx, 4);
  drawText(
    ctx,
    "Payment in form of Demand Draft or At-Par Cheques to be made in favour of FITOVERSE PRIVATE LIMITED. For payment through RTGS/NEFT, bank details are below.",
    { x: MARGIN, size: 9, maxWidth: CONTENT_W }
  );
  space(ctx, 6);
  drawBankBlock(ctx);

  drawSectionTitle(ctx, "The Fitoverse Advantage");
  drawText(
    ctx,
    "Fitoverse Sports Infra is synonymous with world-class sports construction. We bridge the gap between natural playability and modern engineering, offering surfaces that replicate the best qualities of natural fields while significantly reducing maintenance costs and eliminating game cancellations due to weather or uneven terrain.",
    { x: MARGIN, size: 9, maxWidth: CONTENT_W }
  );
  space(ctx, 4);
  drawText(
    ctx,
    "We pride ourselves on being a single-source provider. When you partner with Fitoverse, you engage a team capable of handling the entire project lifecycle — from planning, design, and subfloor construction to professional lighting and precision installation.",
    { x: MARGIN, size: 9, maxWidth: CONTENT_W }
  );
  space(ctx, 4);
  drawText(
    ctx,
    "Our commitment to quality is validated by our adherence to the rigorous standards set by global governing bodies, including FIFA, World Rugby, FIH, ITF, and FIBA.",
    { x: MARGIN, size: 9, maxWidth: CONTENT_W }
  );
  space(ctx, 10);

  // Stats badge row
  ensureSpace(ctx, 50);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, 50, { fill: COL.light });
  const statW = CONTENT_W / 3;
  const drawStat = (col: number, big: string, small: string) => {
    const cx = MARGIN + col * statW + statW / 2;
    const bigW = safeWidth(ctx.bold, big, 14);
    const smallW = safeWidth(ctx.font, small, 8);
    safeDraw(ctx.page, big, {
      x: cx - bigW / 2,
      y: yFromTop(ctx.y + 20),
      size: 14,
      font: ctx.bold,
      color: COL.accent,
    });
    safeDraw(ctx.page, small, {
      x: cx - smallW / 2,
      y: yFromTop(ctx.y + 36),
      size: 8,
      font: ctx.font,
      color: COL.muted,
    });
  };
  drawStat(0, "4 Lakh+", "Sq.Ft. Covered");
  drawStat(1, "65+", "Infra Projects");
  drawStat(2, "FIFA · FIH · ITF · FIBA", "Global Standards");
  ctx.y += 56;

  // Connect with Fitoverse — clickable social/web links. Placed between
  // the Advantage section and Terms & Conditions per user request.
  drawConnectSection(ctx);

  drawFooter(ctx);
  newPage(ctx);

  // ── PAGE 3: T&C + signatures + contacts ──
  drawText(ctx, "TERMS AND CONDITIONS", {
    x: MARGIN,
    size: 13,
    bold: true,
    align: "center",
    maxWidth: CONTENT_W,
    color: COL.accent,
  });
  space(ctx, 6);

  const TERMS = [
    {
      title: "1. Commercial Terms & Payment",
      body: "1.1 Instruments of Payment: All payments must be made in favor of 'FITOVERSE PRIVATE LIMITED' via Demand Draft or At-Par Cheque. 1.2 Validity of Offer: The rates outlined in this proposal are valid subject to the award of the minimum area indicated in the quotation. 1.3 Binding Agreement: This offer becomes a binding contract upon the receipt of a formal Purchase Order (PO) from the Client, accompanied by the stipulated Advance Payment. 1.4 Taxes & Duties: Any statutory upward or downward revision in tax rates, or the introduction of new applicable taxes, shall be borne by the Client.",
    },
    {
      title: "2. Project Schedule & Execution",
      body: "2.1 Lead Time: The project timeline shall be determined based on the total area and scope confirmed in the Purchase Order. 2.2 Commencement: Fitoverse agrees to commence Installation Services within a reasonable timeframe, subject to favorable weather conditions and site readiness. 2.3 Site Access: Upon commencement, the Client must provide 100% unhindered access to the site. 2.4 Delays: Any work stoppage caused by the Client or site conditions will attract proportionate hold-up costs.",
    },
    {
      title: "3. Material Ownership",
      body: "3.1 Surplus Material: Any surplus synthetic surfacing products or extra materials shipped to the site due to requirements shall remain the property of Fitoverse.",
    },
    {
      title: "4. Warranty & Limitation of Liability",
      body: "4.1 General Liability: The liability of Fitoverse regarding any breach of warranty or defect in labor/materials shall strictly not exceed the total value of the Installation Services paid by the Client to Fitoverse. 4.2 Exclusions: Under no circumstances shall Fitoverse be liable for any consequential, punitive, liquidated, or special damages.",
    },
    {
      title: "5. Force Majeure",
      body: "5.1 Fitoverse shall not be liable for any failure or delay in performance due to causes beyond its reasonable control, including acts of God, war, riots, strikes, labor disputes, floods, fire, explosions, shortage of water/power/transportation, government orders, or customs delays.",
    },
    {
      title: "6. Dispute Resolution & Jurisdiction",
      body: "6.1 Mediation & Arbitration: In the event of a dispute, both parties agree to first seek resolution through a mediator. Failing this, the dispute shall be referred to Arbitration. 6.2 Jurisdiction: Any and all unresolved disputes shall be subject to the exclusive jurisdiction of the courts in Salem, Tamil Nadu.",
    },
  ];
  for (const t of TERMS) drawTerm(ctx, t.title, t.body);

  drawSignatures(ctx, data.customerName);

  space(ctx, 12);
  drawLine(ctx, MARGIN, PAGE_W - MARGIN);
  space(ctx, 6);
  drawText(ctx, "Project Contact Points", { x: MARGIN, size: 9, bold: true });
  drawText(ctx, "Mr. Vignesh: +91 63815 02055", { x: MARGIN, size: 9 });
  drawText(ctx, "Mr. Praveen: +91 95977 66524", { x: MARGIN, size: 9 });
  space(ctx, 6);
  drawText(
    ctx,
    "Instagram: FITOVERSE/INSTA  ·  Facebook: FITOVERSE/FACEBOOK  ·  LinkedIn: FITOVERSE/LINKEDIN  ·  WhatsApp: FITOVERSE/WHATSAPP  ·  Website: fitoverse.com",
    { x: MARGIN, size: 9, color: COL.muted, maxWidth: CONTENT_W }
  );

  drawFooter(ctx);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
