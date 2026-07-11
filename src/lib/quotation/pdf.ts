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
// Palette from the Fitoverse quotation design template — charcoal headers, a
// blue primary accent, and a green→blue→dark-blue→magenta gradient rule.
// Brand-green palette matching the reference quotation: green #159341 for
// section heads / table head / accents; blue + red used only for option chips
// and links; dark-slate ink; soft neutrals for cards and rows.
const COL = {
  text: rgb(0.114, 0.157, 0.192), // #1d2831 dark slate ink
  textSoft: rgb(0.275, 0.325, 0.375),
  muted: rgb(0.451, 0.502, 0.549), // #737f8c labels / footer
  charcoal: rgb(0.114, 0.157, 0.192), // (legacy alias) → dark slate
  blue: rgb(0.098, 0.522, 0.851), // #1985d9 — option B1 chip / links
  red: rgb(0.784, 0.067, 0.141), // #c81124 — option B3 chip
  accent: rgb(0.082, 0.576, 0.255), // #159341 brand green — the primary accent
  green: rgb(0.082, 0.576, 0.255), // #159341 (alias for readability)
  greenDeep: rgb(0.043, 0.42, 0.184), // #0b6b2f — grand-total / emphasis text
  greenSoft: rgb(0.914, 0.957, 0.929), // #e9f4ed — pale green band (project, A/B subhead)
  accentSoft: rgb(0.914, 0.957, 0.929), // pale green card highlight
  accentText: rgb(1, 1, 1),
  light: rgb(0.957, 0.965, 0.973), // #f4f6f8 info card
  border: rgb(0.851, 0.871, 0.894), // #d9dee4
  borderStrong: rgb(0.72, 0.75, 0.79),
  rowAlt: rgb(0.972, 0.98, 0.988), // #f8fafc alt row
  highlight: rgb(1, 0.953, 0.749), // #fff3bf highlighted value bg
  highlightText: rgb(0.478, 0.361, 0), // #7a5c00
  grandTotalBg: rgb(0.082, 0.576, 0.255), // #159341 green grand-total band
  link: rgb(0.098, 0.522, 0.851),
};

// The 4-stop brand gradient (green → blue → dark-blue → magenta) at positions
// matching the template's CSS.
const GRAD_STOPS: Array<{ p: number; c: [number, number, number] }> = [
  { p: 0.0, c: [0.122, 0.631, 0.294] }, // #1fa14b green
  { p: 0.42, c: [0.122, 0.525, 0.839] }, // #1f86d6 blue
  { p: 0.7, c: [0.153, 0.251, 0.651] }, // #2740a6 dark blue
  { p: 1.0, c: [0.851, 0.169, 0.341] }, // #d92b57 magenta
];

function gradAt(t: number) {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < GRAD_STOPS.length - 1; i++) {
    const a = GRAD_STOPS[i];
    const b = GRAD_STOPS[i + 1];
    if (x >= a.p && x <= b.p) {
      const f = (x - a.p) / (b.p - a.p || 1);
      return rgb(
        a.c[0] + (b.c[0] - a.c[0]) * f,
        a.c[1] + (b.c[1] - a.c[1]) * f,
        a.c[2] + (b.c[2] - a.c[2]) * f,
      );
    }
  }
  return rgb(...GRAD_STOPS[GRAD_STOPS.length - 1].c);
}

// Draw a horizontal gradient bar (approximated as thin strips) — the brand
// accent rule used at the top of every page + on the grand-total border.
function drawGradientBar(
  page: PDFPage,
  x: number,
  yTop: number,
  w: number,
  h: number,
) {
  const segs = 64;
  const sw = w / segs;
  for (let i = 0; i < segs; i++) {
    page.drawRectangle({
      x: x + i * sw,
      y: PAGE_H - yTop - h,
      width: sw + 0.6,
      height: h,
      color: gradAt(i / (segs - 1)),
    });
  }
}

function inr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Rates keep up to 2 decimals (e.g. 91.35) but drop trailing zeros (23,100).
function inrRate(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
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
  logo: PDFImage | null; // drawn top-left on every page
};

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage(PageSizes.A4);
  ctx.y = MARGIN;
  ctx.pageNumber += 1;
  // Logo top-left on every page (the reference has no top colour bar).
  if (ctx.logo) {
    const f = ctx.logo.scaleToFit(140, 34);
    ctx.page.drawImage(ctx.logo, {
      x: MARGIN,
      y: yFromTop(ctx.y + f.height),
      width: f.width,
      height: f.height,
    });
    ctx.y += f.height + 14;
  } else {
    ctx.y += 6;
  }
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
  // Centered brand footer on every page (matches the reference — no page number
  // or quote number). pdf-lib's y-origin is bottom-left, so a small y sits near
  // the bottom edge; the divider (y+12) sits just above the footer text.
  const y = 22;
  ctx.page.drawLine({
    start: { x: MARGIN, y: y + 12 },
    end: { x: PAGE_W - MARGIN, y: y + 12 },
    color: COL.border,
    thickness: 0.5,
  });
  const text =
    "Fitoverse Pvt. Ltd., SALEM · CHENNAI · BANGALORE      |      PHONE [6381502055]";
  const w = safeWidth(ctx.font, text, 7.5);
  safeDraw(ctx.page, text, {
    x: (PAGE_W - w) / 2,
    y,
    size: 7.5,
    font: ctx.font,
    color: COL.muted,
  });
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
  // Brand gradient rule directly under the charcoal brand band.
  drawGradientBar(ctx.page, MARGIN, ctx.y + 50, CONTENT_W, 3);
  ctx.y += 60;
}

// Map sport → human title shown on the PDF cover. Each sport has its own
// turnkey nomenclature (turf vs court construction vs multisport package).
// Falls back to a generic "Sports Infrastructure" wording for unknown sports.
function titleForSport(sport: string): string {
  switch (sport) {
    case "football":
      return "Quotation for Football Turf Turnkey Solutions";
    case "basketball":
      return "Quotation for Basketball Court Construction";
    case "multisport":
      return "Quotation for Multisport Turnkey Solutions";
    case "pickleball":
      return "Quotation for Pickleball Court Construction";
    default:
      return `Quotation for ${sport ? sport.charAt(0).toUpperCase() + sport.slice(1) : "Sports"} Sports Infrastructure`;
  }
}

// The third payment milestone is tied to installing the sport's headline
// fixture. Naming it per-sport stops a football / cricket / pickleball quote
// from reading "installation of basketball poles."
function installationMilestone(sport: string): string {
  switch (sport) {
    case "basketball":
      return "installation of basketball poles";
    case "football":
      return "installation of goal posts & nets";
    case "cricket":
      return "installation of nets & fencing";
    case "tennis":
      return "installation of net posts & fencing";
    case "badminton":
    case "volleyball":
    case "pickleball":
      return "installation of net posts";
    case "multisport":
      return "installation of poles, nets & fixtures";
    default:
      return "installation of sports fixtures";
  }
}

function drawTitle(ctx: Ctx, sport: string) {
  space(ctx, 4);
  const t = titleForSport(sport);
  drawText(ctx, t, {
    x: MARGIN,
    size: 16,
    bold: true,
    align: "center",
    maxWidth: CONTENT_W,
    color: COL.accent,
  });
  // Decorative underline centered under the title (sized to the wrapped
  // result; titles longer than the content area wrap to two lines)
  const titleWidth = safeWidth(ctx.bold, t, 16);
  void titleWidth; // keep for backwards-compat reference
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
      // Dual-unit display (Option C — customer PDFs always show both
      // ft + m so no conversion needed on their side).
      value: `${lengthFt} × ${widthFt} ft (${(lengthFt * 0.3048).toFixed(1)} × ${(widthFt * 0.3048).toFixed(1)} m) = ${inr(lengthFt * widthFt)} sq.ft (${inr(Math.round(lengthFt * widthFt * 0.0929))} m²)`,
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

// ── Reference-style page-1 masthead: logo top-left, "Quotation for <subject>",
// a From / To / Quoted-on block, and a green Project accent band. Replaces the
// old charcoal brand band + centered title + grey info grid. No image for now
// (a real sport photo may be slotted in later — never the 2D plan). ──

function projectLabelForSport(sport: string): string {
  switch (sport) {
    case "football":
      return "Football Turf";
    case "cricket":
      return "Cricket Turf";
    case "basketball":
      return "Basketball Court";
    case "pickleball":
      return "Pickleball Court";
    case "tennis":
      return "Tennis Court";
    case "badminton":
      return "Badminton Court";
    case "volleyball":
      return "Volleyball Court";
    case "multisport":
      return "Multisport Arena";
    default:
      return sport ? sport.charAt(0).toUpperCase() + sport.slice(1) : "Sports Court";
  }
}

function drawBrandLogo(ctx: Ctx, logoImage: PDFImage | null) {
  if (logoImage) {
    const f = logoImage.scaleToFit(160, 44);
    ctx.page.drawImage(logoImage, {
      x: MARGIN,
      y: yFromTop(ctx.y + f.height),
      width: f.width,
      height: f.height,
    });
    ctx.y += f.height;
  } else {
    safeDraw(ctx.page, "FIT O VERSE", {
      x: MARGIN,
      y: yFromTop(ctx.y + 22),
      size: 20,
      font: ctx.bold,
      color: COL.green,
    });
    ctx.y += 24;
  }
  space(ctx, 16);
}

function drawQuoteTitle(ctx: Ctx, sport: string) {
  safeDraw(ctx.page, "Quotation for", {
    x: MARGIN,
    y: yFromTop(ctx.y + 11),
    size: 11,
    font: ctx.font,
    color: COL.muted,
  });
  ctx.y += 18;
  const subject = titleForSport(sport).replace(/^Quotation for\s+/i, "");
  drawText(ctx, subject, {
    x: MARGIN,
    size: 22,
    bold: true,
    color: COL.text,
    maxWidth: CONTENT_W,
  });
  space(ctx, 16);
}

function drawFromTo(ctx: Ctx, customerName: string, quoteDate: string) {
  const parts = (customerName ?? "").split(",");
  const toName = (parts[0] ?? "").trim();
  const city = parts.slice(1).join(",").trim();
  const colW = CONTENT_W / 2;
  const s = ctx.y;
  ensureSpace(ctx, 84);
  // From (left)
  safeDraw(ctx.page, "From", { x: MARGIN, y: yFromTop(s + 9), size: 9, font: ctx.font, color: COL.muted });
  safeDraw(ctx.page, "Fitoverse Private Limited", { x: MARGIN, y: yFromTop(s + 26), size: 13, font: ctx.bold, color: COL.text });
  safeDraw(ctx.page, "Phone: 6381502055", { x: MARGIN, y: yFromTop(s + 40), size: 9, font: ctx.font, color: COL.textSoft });
  safeDraw(ctx.page, "GSTIN: 33AAECF8905G1ZQ", { x: MARGIN, y: yFromTop(s + 52), size: 9, font: ctx.font, color: COL.textSoft });
  // To (right)
  const rx = MARGIN + colW;
  safeDraw(ctx.page, "To", { x: rx, y: yFromTop(s + 9), size: 9, font: ctx.font, color: COL.muted });
  safeDraw(ctx.page, toName, { x: rx, y: yFromTop(s + 26), size: 13, font: ctx.bold, color: COL.text });
  if (city) safeDraw(ctx.page, city, { x: rx, y: yFromTop(s + 40), size: 9, font: ctx.font, color: COL.textSoft });
  safeDraw(ctx.page, "Quoted on", { x: rx, y: yFromTop(s + 60), size: 9, font: ctx.font, color: COL.muted });
  safeDraw(ctx.page, quoteDate, { x: rx, y: yFromTop(s + 74), size: 12, font: ctx.bold, color: COL.text });
  ctx.y = s + 84;
  space(ctx, 8);
}

function drawProjectLine(ctx: Ctx, sport: string, lengthFt: number, widthFt: number, city: string) {
  const h = 28;
  ensureSpace(ctx, h);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, h, { fill: COL.greenSoft });
  drawRect(ctx, MARGIN, ctx.y, 3, h, { fill: COL.accent });
  const area = lengthFt * widthFt;
  const prefix = "Project:  ";
  const detail = `${projectLabelForSport(sport)} - ${lengthFt} ft x ${widthFt} ft (${inr(area)} sq ft)${city ? ", " + city : ""}`;
  const baseY = yFromTop(ctx.y + 18);
  safeDraw(ctx.page, prefix, { x: MARGIN + 12, y: baseY, size: 10, font: ctx.font, color: COL.muted });
  const px = MARGIN + 12 + safeWidth(ctx.font, prefix, 10);
  safeDraw(ctx.page, detail, { x: px, y: baseY, size: 10, font: ctx.bold, color: COL.text });
  ctx.y += h;
  space(ctx, 10);
}

// Fetch + embed each line item's product photo (PNG/JPG only — pdf-lib can't
// embed WEBP). Returns a map of item id -> embedded image. Any failure is
// silently skipped so a broken URL never breaks the whole quote.
async function embedLineItemImages(
  doc: PDFDocument,
  items: QuoteLineItem[],
): Promise<Map<string, PDFImage>> {
  const map = new Map<string, PDFImage>();
  for (const it of items) {
    if (!it.included || !it.imageUrl) continue;
    try {
      // Bounded fetch so a slow/hung blob URL can't stall PDF generation —
      // the item just renders without its photo instead.
      const res = await fetch(it.imageUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      let img: PDFImage | null = null;
      if (bytes[0] === 0x89 && bytes[1] === 0x50) img = await doc.embedPng(bytes);
      else if (bytes[0] === 0xff && bytes[1] === 0xd8) img = await doc.embedJpg(bytes);
      if (img) map.set(it.id, img);
    } catch {
      // ignore — the item just renders without a photo
    }
  }
  return map;
}

function drawItemsTable(
  ctx: Ctx,
  items: QuoteLineItem[],
  images: Map<string, PDFImage>,
) {
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

  // Column header — extracted so it can be RE-EMITTED after a page break. The
  // body loop's ensureSpace() can start a new page mid-table; without redrawing
  // this, the overflow rows on page 2+ rendered with no "Service Description /
  // Area / Rate / Total" band, leaving the Area/Rate/Total columns unlabeled.
  const drawTableHeader = () => {
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
  };

  // Header row
  drawTableHeader();

  // Body rows
  let rowIdx = 0;
  const DESC_SIZE = 9; // was 8 — bumped for readability
  const DESC_LH = 13; // line height for the description
  const IMG_MAX_W = 155;
  const IMG_MAX_H = 115;
  for (const item of items) {
    if (!item.included) continue;

    // Optional product photo shown at the top of the description.
    const img = images.get(item.id);
    let imgW = 0;
    let imgH = 0;
    if (img) {
      const s = Math.min(IMG_MAX_W / img.width, IMG_MAX_H / img.height, 1);
      imgW = img.width * s;
      imgH = img.height * s;
    }

    // Estimate row height: pad + name + [photo] + desc + gst tag + pad
    const descLines = wordWrap(ctx.font, item.description, DESC_SIZE, cols.desc - 12);
    const photoBlockH = img ? imgH + 10 : 0;
    // 8 top pad + 24 name block + photo + description + 16 GST tag + 8 pad.
    const rowH = 8 + 24 + photoBlockH + descLines.length * DESC_LH + 16 + 8;
    const pageBefore = ctx.pageNumber;
    ensureSpace(ctx, rowH);
    // If this row forced a page break, re-emit the column header on top of it.
    if (ctx.pageNumber !== pageBefore) drawTableHeader();
    if (rowIdx % 2 === 1) drawRect(ctx, MARGIN, ctx.y, CONTENT_W, rowH, { fill: COL.rowAlt });

    const startY = ctx.y + 8;
    // Item name (bold)
    safeDraw(ctx.page, item.name, {
      x: colXs.desc + 6,
      y: yFromTop(startY + 10),
      size: 10.5,
      font: ctx.bold,
      color: COL.text,
    });
    let cursorY = startY + 24; // below the name

    // Product photo at the top of the description (with a thin frame).
    if (img) {
      ctx.page.drawImage(img, {
        x: colXs.desc + 6,
        y: yFromTop(cursorY + imgH),
        width: imgW,
        height: imgH,
      });
      ctx.page.drawRectangle({
        x: colXs.desc + 6,
        y: yFromTop(cursorY + imgH),
        width: imgW,
        height: imgH,
        borderColor: COL.borderStrong,
        borderWidth: 0.75,
      });
      cursorY += imgH + 10;
    }

    // Description (wrapped) — darker + larger + roomier for readability.
    for (const line of descLines) {
      safeDraw(ctx.page, line, {
        x: colXs.desc + 6,
        y: yFromTop(cursorY + DESC_SIZE),
        size: DESC_SIZE,
        font: ctx.font,
        color: COL.textSoft,
      });
      cursorY += DESC_LH;
    }
    // GST tag
    safeDraw(ctx.page, `(GST ${item.gstPercent}%)`, {
      x: colXs.desc + 6,
      y: yFromTop(cursorY + 8),
      size: 7.5,
      font: ctx.font,
      color: COL.muted,
    });

    // Right-aligned numbers (aligned with the item name)
    const drawNum = (text: string, colX: number, colW: number) => {
      const w = safeWidth(ctx.font, text, 9);
      safeDraw(ctx.page, text, {
        x: colX + colW - w - 6,
        y: yFromTop(startY + 10),
        size: 9,
        font: ctx.font,
        color: COL.text,
      });
    };
    // Per-piece rows ("nos") show the count with its unit so a bare "1"
    // doesn't read as 1 sq.ft; area rows keep the plain number.
    const areaLabel =
      item.unit && item.unit !== "sq.ft"
        ? `${inr(item.areaSqFt)} ${item.unit}`
        : inr(item.areaSqFt);
    drawNum(areaLabel, colXs.area, cols.area);
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

  // Grand total band — brand green.
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
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, blockH, { fill: COL.greenSoft, border: COL.border });
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

// ─── Reference-style quote body: particulars table, option comparison, spec
// cards, and the full-page Advantage + Connect closers. ───────────────────────

function drawCentered(
  ctx: Ctx,
  text: string,
  x0: number,
  w: number,
  yTop: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
) {
  const tw = safeWidth(font, text, size);
  safeDraw(ctx.page, text, { x: x0 + (w - tw) / 2, y: yFromTop(yTop + size), size, font, color });
}

function gstLabel(g: number): string {
  return g > 0 ? `${g}%` : "Nil";
}

function optionFill(color?: string | null) {
  return color === "green" ? COL.accent : color === "red" ? COL.red : COL.blue;
}

function drawOptionChip(ctx: Ctx, x: number, yTop: number, tag: string, color?: string | null): number {
  const label = `OPTION ${tag}`;
  const fs = 6.5;
  const padX = 4;
  const w = safeWidth(ctx.bold, label, fs) + padX * 2;
  const h = 12;
  ctx.page.drawRectangle({ x, y: yFromTop(yTop + h), width: w, height: h, color: optionFill(color) });
  safeDraw(ctx.page, label, { x: x + padX, y: yFromTop(yTop + h - 3), size: fs, font: ctx.bold, color: rgb(1, 1, 1) });
  return w;
}

// Six-column particulars table (PARTICULARS · UNIT · QTY · RATE · GST · AMOUNT)
// with optional A/B section subheaders and option chips.
function drawParticularsTable(ctx: Ctx, items: QuoteLineItem[]) {
  const cols = { part: 264, unit: 44, qty: 48, rate: 55, gst: 42, amt: 70 };
  const x = {
    part: MARGIN,
    unit: MARGIN + cols.part,
    qty: MARGIN + cols.part + cols.unit,
    rate: MARGIN + cols.part + cols.unit + cols.qty,
    gst: MARGIN + cols.part + cols.unit + cols.qty + cols.rate,
    amt: MARGIN + cols.part + cols.unit + cols.qty + cols.rate + cols.gst,
  };
  const headerH = 20;
  const centerAt = (t: string, cx0: number, cw: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, y: number) => {
    const w = safeWidth(font, t, size);
    safeDraw(ctx.page, t, { x: cx0 + (cw - w) / 2, y, size, font, color });
  };
  const rightAt = (t: string, cx0: number, cw: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, y: number) => {
    const w = safeWidth(font, t, size);
    safeDraw(ctx.page, t, { x: cx0 + cw - w - 6, y, size, font, color });
  };
  const drawHead = () => {
    ensureSpace(ctx, headerH);
    drawRect(ctx, MARGIN, ctx.y, CONTENT_W, headerH, { fill: COL.accent });
    const hy = yFromTop(ctx.y + 13.5);
    safeDraw(ctx.page, "PARTICULARS", { x: x.part + 8, y: hy, size: 8.5, font: ctx.bold, color: COL.accentText });
    centerAt("UNIT", x.unit, cols.unit, 8.5, ctx.bold, COL.accentText, hy);
    rightAt("QTY", x.qty, cols.qty, 8.5, ctx.bold, COL.accentText, hy);
    rightAt("RATE", x.rate, cols.rate, 8.5, ctx.bold, COL.accentText, hy);
    centerAt("GST", x.gst, cols.gst, 8.5, ctx.bold, COL.accentText, hy);
    rightAt("AMOUNT", x.amt, cols.amt, 8.5, ctx.bold, COL.accentText, hy);
    ctx.y += headerH;
  };
  drawHead();
  let lastSection: string | null = null;
  let rowIdx = 0;
  for (const item of items) {
    if (!item.included) continue;
    const sec = item.section ?? null;
    if (sec && sec !== lastSection) {
      const subH = 17;
      const pb = ctx.pageNumber;
      ensureSpace(ctx, subH + 30);
      if (ctx.pageNumber !== pb) drawHead();
      drawRect(ctx, MARGIN, ctx.y, CONTENT_W, subH, { fill: COL.greenSoft });
      safeDraw(ctx.page, sec, { x: x.part + 8, y: yFromTop(ctx.y + 12), size: 8.5, font: ctx.bold, color: COL.greenDeep });
      ctx.y += subH;
      lastSection = sec;
      rowIdx = 0;
    }
    const descLines = wordWrap(ctx.font, item.description, 8, cols.part - 16);
    const rowH = 8 + 13 + descLines.length * 10 + 8;
    const pb = ctx.pageNumber;
    ensureSpace(ctx, rowH);
    if (ctx.pageNumber !== pb) { drawHead(); lastSection = null; }
    if (rowIdx % 2 === 1) drawRect(ctx, MARGIN, ctx.y, CONTENT_W, rowH, { fill: COL.rowAlt });
    const sy = ctx.y + 8;
    const nameY = yFromTop(sy + 9);
    safeDraw(ctx.page, item.name, { x: x.part + 8, y: nameY, size: 9.5, font: ctx.bold, color: COL.text });
    if (item.optionTag) {
      const nameW = safeWidth(ctx.bold, item.name, 9.5);
      drawOptionChip(ctx, x.part + 8 + nameW + 8, sy, item.optionTag, item.optionColor);
    }
    let cy = sy + 15;
    for (const ln of descLines) {
      safeDraw(ctx.page, ln, { x: x.part + 8, y: yFromTop(cy + 8), size: 8, font: ctx.font, color: COL.textSoft });
      cy += 10;
    }
    const amt = item.areaSqFt * item.ratePerSqFt;
    centerAt(item.unit ?? "sq ft", x.unit, cols.unit, 8.5, ctx.font, COL.text, nameY);
    rightAt(inr(item.areaSqFt), x.qty, cols.qty, 9, ctx.font, COL.text, nameY);
    rightAt(inrRate(item.ratePerSqFt), x.rate, cols.rate, 9, ctx.font, COL.text, nameY);
    centerAt(gstLabel(item.gstPercent), x.gst, cols.gst, 8.5, ctx.font, COL.text, nameY);
    rightAt(inr(amt), x.amt, cols.amt, 9, ctx.font, COL.text, nameY);
    ctx.page.drawLine({ start: { x: MARGIN, y: yFromTop(ctx.y + rowH) }, end: { x: PAGE_W - MARGIN, y: yFromTop(ctx.y + rowH) }, color: COL.border, thickness: 0.5 });
    ctx.y += rowH;
    rowIdx++;
  }
  space(ctx, 6);
}

function anyOptions(items: QuoteLineItem[]): boolean {
  return items.some((i) => i.included && !!i.optionTag);
}

// "Total Payable — choose one option" comparison. Common (untagged) items form
// the base; each tagged item is one alternative column.
function drawComparisonTable(ctx: Ctx, items: QuoteLineItem[]) {
  const common = items.filter((i) => i.included && !i.optionTag);
  const opts = items.filter((i) => i.included && i.optionTag);
  const commonAmt = common.reduce((s, i) => s + i.areaSqFt * i.ratePerSqFt, 0);
  const commonGst = common.reduce((s, i) => s + (i.areaSqFt * i.ratePerSqFt * i.gstPercent) / 100, 0);
  const headerH = 32;
  // Keep the section title with its table (don't orphan the title at a page end).
  ensureSpace(ctx, 30 + headerH + 5 * 20 + 12);
  drawSectionTitle(ctx, "Total Payable - choose one option");
  const labelW = 156;
  const optW = (CONTENT_W - labelW) / opts.length;
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, headerH, { fill: COL.accent });
  safeDraw(ctx.page, "Amount Details", { x: MARGIN + 8, y: yFromTop(ctx.y + 19), size: 9, font: ctx.bold, color: COL.accentText });
  opts.forEach((o, i) => {
    const cx = MARGIN + labelW + i * optW;
    const t1 = `Option ${o.optionTag}`;
    const w1 = safeWidth(ctx.bold, t1, 9);
    safeDraw(ctx.page, t1, { x: cx + optW - w1 - 8, y: yFromTop(ctx.y + 13), size: 9, font: ctx.bold, color: COL.accentText });
    let sub = o.optionShort ?? o.name ?? "";
    while (sub.length > 3 && safeWidth(ctx.font, sub, 7) > optW - 14) sub = sub.slice(0, -1);
    const w2 = safeWidth(ctx.font, sub, 7);
    safeDraw(ctx.page, sub, { x: cx + optW - w2 - 8, y: yFromTop(ctx.y + 25), size: 7, font: ctx.font, color: COL.accentText });
  });
  ctx.y += headerH;
  const rowH = 20;
  const drawRow = (label: string, valueFor: (o: QuoteLineItem) => number, o2: { bold?: boolean; band?: boolean } = {}) => {
    const h = o2.band ? rowH + 4 : rowH;
    if (o2.band) drawRect(ctx, MARGIN, ctx.y, CONTENT_W, h, { fill: COL.grandTotalBg });
    const ty = yFromTop(ctx.y + (o2.band ? 16 : 13));
    const size = o2.bold ? 10 : 9;
    const font = o2.bold ? ctx.bold : ctx.font;
    const col = o2.band ? COL.accentText : COL.text;
    safeDraw(ctx.page, label, { x: MARGIN + 8, y: ty, size, font, color: col });
    opts.forEach((o, i) => {
      const cx = MARGIN + labelW + i * optW;
      const v = inr(valueFor(o));
      const w = safeWidth(font, v, size);
      safeDraw(ctx.page, v, { x: cx + optW - w - 8, y: ty, size, font, color: col });
    });
    if (!o2.band) {
      ctx.page.drawLine({ start: { x: MARGIN, y: yFromTop(ctx.y + rowH) }, end: { x: PAGE_W - MARGIN, y: yFromTop(ctx.y + rowH) }, color: COL.border, thickness: 0.5 });
    }
    ctx.y += h;
  };
  const turf = (o: QuoteLineItem) => o.areaSqFt * o.ratePerSqFt;
  const turfGst = (o: QuoteLineItem) => (o.areaSqFt * o.ratePerSqFt * o.gstPercent) / 100;
  drawRow("Ground preparation", () => commonAmt);
  drawRow("Flooring / Turf", turf);
  drawRow("Sub Total (without GST)", (o) => commonAmt + turf(o), { bold: true });
  drawRow("GST (nil on ground prep)", (o) => commonGst + turfGst(o));
  drawRow("Grand Total (Rs)", (o) => commonAmt + turf(o) + commonGst + turfGst(o), { bold: true, band: true });
  space(ctx, 6);
}

function specSectionTitle(sport: string): string {
  return sport === "football" || sport === "cricket" ? "Turf Specifications" : "Product Specifications";
}

// Up to three side-by-side spec cards (title + bullet specs).
function drawSpecCards(ctx: Ctx, items: QuoteLineItem[]) {
  const cards = items.slice(0, 3);
  const n = cards.length;
  const gap = 12;
  const cardW = (CONTENT_W - gap * (n - 1)) / n;
  const titleSize = 9.5;
  const bulletSize = 8;
  const lh = 12;
  const prepared = cards.map((it) => {
    const lines: string[] = [];
    for (const s of it.specs ?? []) {
      const wrapped = wordWrap(ctx.font, `${s.label}: ${s.value}`, bulletSize, cardW - 26);
      wrapped.forEach((w, idx) => lines.push((idx === 0 ? "- " : "  ") + w));
    }
    return { it, lines };
  });
  const maxLines = prepared.reduce((m, c) => Math.max(m, c.lines.length), 0);
  const cardH = 16 + 20 + maxLines * lh + 10;
  ensureSpace(ctx, cardH + 6);
  const top = ctx.y;
  prepared.forEach((c, i) => {
    const cx = MARGIN + i * (cardW + gap);
    drawRect(ctx, cx, top, cardW, cardH, { fill: rgb(1, 1, 1), border: COL.border });
    let title = c.it.optionShort ?? c.it.name ?? "";
    while (title.length > 4 && safeWidth(ctx.bold, title, titleSize) > cardW - 20) title = title.slice(0, -1);
    safeDraw(ctx.page, title, { x: cx + 12, y: yFromTop(top + 20), size: titleSize, font: ctx.bold, color: COL.green });
    let yy = top + 34;
    for (const ln of c.lines) {
      safeDraw(ctx.page, ln, { x: cx + 12, y: yFromTop(yy + 8), size: bulletSize, font: ctx.font, color: COL.textSoft });
      yy += lh;
    }
  });
  ctx.y = top + cardH;
  space(ctx, 6);
}

function drawNumbered(ctx: Ctx, lines: string[]) {
  lines.forEach((line, i) => {
    const num = `${i + 1}.`;
    const wrapped = wordWrap(ctx.font, line, 9, CONTENT_W - 28);
    ensureSpace(ctx, wrapped.length * 12 + 2);
    safeDraw(ctx.page, num, { x: MARGIN + 4, y: yFromTop(ctx.y + 8), size: 9, font: ctx.font, color: COL.text });
    let ly = ctx.y;
    for (const w of wrapped) {
      safeDraw(ctx.page, w, { x: MARGIN + 22, y: yFromTop(ly + 8), size: 9, font: ctx.font, color: COL.text });
      ly += 12;
    }
    ctx.y = ly + 2;
  });
}

function drawSubheading(ctx: Ctx, title: string) {
  space(ctx, 6);
  ensureSpace(ctx, 16);
  safeDraw(ctx.page, title, { x: MARGIN, y: yFromTop(ctx.y + 10), size: 10, font: ctx.bold, color: COL.green });
  ctx.y += 16;
}

function drawPaymentTerms(ctx: Ctx, sport: string) {
  const parts: Array<[string, string]> = [
    ["50%", "advance during purchase order"],
    ["30%", "during flooring work"],
    ["15%", `after ${installationMilestone(sport)}`],
    ["5%", "after completion of work"],
  ];
  for (const [pct, rest] of parts) {
    ensureSpace(ctx, 15);
    safeDraw(ctx.page, pct, { x: MARGIN + 4, y: yFromTop(ctx.y + 9), size: 9.5, font: ctx.bold, color: COL.green });
    const pw = safeWidth(ctx.bold, pct, 9.5);
    safeDraw(ctx.page, "  " + rest, { x: MARGIN + 4 + pw, y: yFromTop(ctx.y + 9), size: 9.5, font: ctx.font, color: COL.text });
    ctx.y += 15;
  }
}

// ── Phase F: full-page "The Fitoverse Advantage" ──
function drawAdvantagePage(ctx: Ctx) {
  space(ctx, 6);
  safeDraw(ctx.page, "The Fitoverse Advantage", { x: MARGIN, y: yFromTop(ctx.y + 22), size: 22, font: ctx.bold, color: COL.text });
  ctx.y += 30;
  ctx.page.drawLine({ start: { x: MARGIN, y: yFromTop(ctx.y) }, end: { x: MARGIN + 64, y: yFromTop(ctx.y) }, color: COL.accent, thickness: 2.5 });
  space(ctx, 16);
  const paras = [
    "Fitoverse Sports Infra is synonymous with world-class sports construction. We bridge the gap between natural playability and modern engineering, offering surfaces that replicate the best qualities of natural fields while significantly reducing maintenance costs and eliminating game cancellations due to weather or uneven terrain.",
    "We pride ourselves on being a single-source provider. When you partner with Fitoverse, you engage a team capable of handling the entire project lifecycle - from planning, design, and subfloor construction to professional lighting and precision installation.",
    "Our commitment to quality is validated by our adherence to the rigorous standards set by global governing bodies, including FIFA, World Rugby, FIH, ITF, and FIBA.",
  ];
  for (const p of paras) {
    drawText(ctx, p, { x: MARGIN, size: 10, maxWidth: CONTENT_W, color: COL.textSoft });
    space(ctx, 8);
  }
  space(ctx, 14);
  const cardW = (CONTENT_W - 16) / 2;
  const cardH = 74;
  ensureSpace(ctx, cardH + 20);
  const top = ctx.y;
  drawRect(ctx, MARGIN, top, cardW, cardH, { fill: COL.light, border: COL.border });
  drawCentered(ctx, "PROUD MEMBERS OF", MARGIN, cardW, top + 16, 10, ctx.bold, COL.text);
  drawCentered(ctx, "IAKS   ·   SFBA India", MARGIN, cardW, top + 42, 13, ctx.bold, COL.green);
  const c2 = MARGIN + cardW + 16;
  drawRect(ctx, c2, top, cardW, cardH, { fill: COL.light, border: COL.border });
  drawCentered(ctx, "WE USE FLOORINGS AUTHORIZED BY", c2, cardW, top + 16, 10, ctx.bold, COL.text);
  drawCentered(ctx, "FIFA Quality   ·   FIFA Quality Pro", c2, cardW, top + 42, 13, ctx.bold, COL.green);
  ctx.y = top + cardH;
  space(ctx, 18);
  const statH = 66;
  ensureSpace(ctx, statH);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, statH, { fill: COL.greenSoft });
  const statTop = ctx.y;
  const halfW = CONTENT_W / 2;
  drawCentered(ctx, "65+", MARGIN, halfW, statTop + 18, 26, ctx.bold, COL.green);
  drawCentered(ctx, "infra projects", MARGIN, halfW, statTop + 46, 10, ctx.font, COL.muted);
  drawCentered(ctx, "4 Lakh+", MARGIN + halfW, halfW, statTop + 18, 26, ctx.bold, COL.green);
  drawCentered(ctx, "Sq. Ft. Covered", MARGIN + halfW, halfW, statTop + 46, 10, ctx.font, COL.muted);
  ctx.y += statH;
}

// ── Phase G: full-page "Connect With Us" (final page) ──
function drawConnectPage(ctx: Ctx) {
  space(ctx, 34);
  if (ctx.logo) {
    const f = ctx.logo.scaleToFit(240, 74);
    ctx.page.drawImage(ctx.logo, { x: (PAGE_W - f.width) / 2, y: yFromTop(ctx.y + f.height), width: f.width, height: f.height });
    ctx.y += f.height;
  }
  space(ctx, 26);
  drawCentered(ctx, "Connect With Us", MARGIN, CONTENT_W, ctx.y, 22, ctx.bold, COL.text);
  ctx.y += 30;
  drawCentered(ctx, "Reach out for a site visit, a detailed quote, or a walkthrough of our work.", MARGIN, CONTENT_W, ctx.y, 10, ctx.font, COL.muted);
  ctx.y += 34;
  const rows: Array<[string, string, string | null]> = [
    ["Phone", "+91 63815 02055   ·   +91 93638 63382", null],
    ["Website", "fitoverse.com", "https://fitoverse.com/"],
    ["Instagram", "fito.verse", "https://www.instagram.com/fito.verse/"],
    ["LinkedIn", "Fitoverse", "https://www.linkedin.com/company/fitoverse/"],
    ["Facebook", "Fitoverse", "https://www.facebook.com/profile.php?id=100077279349300"],
  ];
  const panelW = 380;
  const px = (PAGE_W - panelW) / 2;
  const panelH = rows.length * 26 + 20;
  drawRect(ctx, px, ctx.y, panelW, panelH, { fill: COL.greenSoft, border: COL.border });
  let ry = ctx.y + 14;
  for (const [label, value, url] of rows) {
    safeDraw(ctx.page, label, { x: px + 24, y: yFromTop(ry + 10), size: 10, font: ctx.bold, color: COL.green });
    if (url) {
      drawLink(ctx, value, url, { x: px + 130, y: ry, size: 10 });
    } else {
      safeDraw(ctx.page, value, { x: px + 130, y: yFromTop(ry + 10), size: 10, font: ctx.font, color: COL.text });
    }
    ry += 26;
  }
  ctx.y += panelH;
  space(ctx, 24);
  drawCentered(ctx, "Fitoverse Private Limited   ·   SALEM · CHENNAI · BANGALORE", MARGIN, CONTENT_W, ctx.y, 9, ctx.font, COL.muted);
  ctx.y += 16;
  drawCentered(ctx, "GSTIN 33AAECF8905G1ZQ   ·   CIN U92490TZ2022PTC038004", MARGIN, CONTENT_W, ctx.y, 8, ctx.font, COL.muted);
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
    logo: logoImage,
  };

  // ── PAGE 1: masthead (logo + From/To + project), line items, totals, notes ──
  const quoteDateStr = data.quoteDate
    .toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    .replace(/\//g, " / ");
  const cityFromName = (data.customerName ?? "").split(",").slice(1).join(",").trim();
  space(ctx, 6);
  drawBrandLogo(ctx, logoImage);
  drawQuoteTitle(ctx, data.sport);
  drawFromTo(ctx, data.customerName, quoteDateStr);
  drawProjectLine(ctx, data.sport, data.lengthFt, data.widthFt, cityFromName);
  space(ctx, 6);
  const hasOptions = anyOptions(data.lineItems);
  drawSectionTitle(ctx, "Commercial Quotation");
  const surface = data.sport === "football" || data.sport === "cricket" ? "turf" : "flooring";
  const introBase = `Turnkey ${projectLabelForSport(data.sport).toLowerCase()} for a ${data.lengthFt} x ${data.widthFt} ft (${inr(data.lengthFt * data.widthFt)} sq ft) ground${cityFromName ? " at " + cityFromName : ""}.`;
  const intro = hasOptions
    ? `${introBase} Ground preparation is common to all options; the ${surface} is a choose-one selection across the grades below. GST is charged extra on ${surface} only (no GST on ground preparation).`
    : `${introBase} Rates are inclusive of installation. GST is charged extra as applicable and shown separately.`;
  drawText(ctx, intro, { x: MARGIN, size: 9.5, maxWidth: CONTENT_W, color: COL.textSoft });
  space(ctx, 8);
  drawParticularsTable(ctx, data.lineItems);
  if (hasOptions) drawComparisonTable(ctx, data.lineItems);
  else drawTotals(ctx, data.subtotal, data.gstAmount, data.grandTotal);

  // Specifications (only when items carry structured specs)
  const specItems = data.lineItems.filter((i) => i.included && i.specs && i.specs.length);
  if (specItems.length) {
    drawSectionTitle(ctx, specSectionTitle(data.sport));
    drawSpecCards(ctx, specItems);
  }

  // Notes / Client Work Scope / Payment Terms + bank
  drawSectionTitle(ctx, "Notes");
  drawNumbered(ctx, [
    "Installation charges are included in the above rates.",
    "GST is charged extra as shown; ground preparation carries no GST.",
    "Freight / transport charges extra for materials at actuals.",
    "Client's scope: levelled ground to be provided; power, water and handling support at site.",
    "Food and stay for the installation team on client scope.",
    "Unloading, shifting and storage at the project site on client scope.",
    "Warranty as applicable to the selected surface, excluding damage from misuse, vandalism or natural calamities.",
  ]);
  drawSubheading(ctx, "Client Work Scope");
  drawBullets(ctx, [
    "Site to be ready, clean and levelled before commencement.",
    "Power, water, unloading, shifting and storage support at site.",
    "Food and stay for the installation team.",
  ]);
  drawSectionTitle(ctx, "Payment Terms");
  drawPaymentTerms(ctx, data.sport);
  space(ctx, 4);
  drawText(ctx, "Payment by Demand Draft or At-Par Cheque in favour of FITOVERSE PRIVATE LIMITED. For RTGS/NEFT:", { x: MARGIN, size: 9, maxWidth: CONTENT_W });
  space(ctx, 6);
  drawBankBlock(ctx);

  if (data.notes && data.notes.trim()) {
    drawSubheading(ctx, "Additional Notes");
    drawText(ctx, data.notes.trim(), { x: MARGIN, size: 9, maxWidth: CONTENT_W });
  }

  // ── Terms & Conditions (flows after the bank block; paginates as needed) ──
  space(ctx, 8);
  drawSectionTitle(ctx, "Terms & Conditions");
  drawText(ctx, "FITOVERSE PRIVATE LIMITED     CIN: U92490TZ2022PTC038004     |     GSTIN: 33AAECF8905G1ZQ", { x: MARGIN, size: 8.5, maxWidth: CONTENT_W, color: COL.muted });
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
  drawText(ctx, "Mr. Vignesh: +91 63815 02055      Mr. Praveen: +91 95977 66524      www.fitoverse.com", {
    x: MARGIN,
    size: 9,
    color: COL.muted,
  });

  // ── The Fitoverse Advantage (full page) ──
  drawFooter(ctx);
  newPage(ctx);
  drawAdvantagePage(ctx);

  // ── Connect With Us (final page) ──
  drawFooter(ctx);
  newPage(ctx);
  drawConnectPage(ctx);

  drawFooter(ctx);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
