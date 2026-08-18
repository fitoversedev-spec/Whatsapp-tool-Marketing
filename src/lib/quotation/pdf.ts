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
import { sectionOrder } from "./sections";
import { convertToPng, isPng, isJpg } from "../pdf-image";
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

// Real project photos for the showcase page (between "The Fitoverse
// Advantage" and "Connect With Us") — one per sport, added as they become
// available. A sport with no photo here simply skips that page entirely
// (see renderQuotationPdf).
const SHOWCASE_PHOTO_FILES: Partial<Record<string, string>> = {
  football: "football-project.jpg",
  basketball: "basketball-project.jpg",
};
const SHOWCASE_PHOTO_BYTES: Partial<Record<string, Buffer>> = {};
for (const [sport, file] of Object.entries(SHOWCASE_PHOTO_FILES)) {
  try {
    SHOWCASE_PHOTO_BYTES[sport] = fs.readFileSync(
      path.join(process.cwd(), "public", "quotation-assets", file!)
    );
  } catch {
    // no photo on disk for this sport yet — page is skipped
  }
}

const PAGE_W = PageSizes.A4[0]; // 595.28
const PAGE_H = PageSizes.A4[1]; // 841.89
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_RESERVE = 30;

// Plain government bill-of-quantities palette — neutral greys, near-black
// grid lines, dark-slate ink throughout. The brand-green multi-block look was
// retired in favour of a plain/readable BOQ aesthetic: white/grey bands with
// black borders, ink text, and no coloured header fills. Several keys keep
// their old (brand) names for compatibility with dead code paths
// (drawHeader/drawItemsTable/drawConnectSection) but now resolve to neutral
// values, so the whole live document renders plainly.
const COL = {
  text: rgb(0.114, 0.157, 0.192), // #1d2831 dark slate ink
  textSoft: rgb(0.30, 0.34, 0.38), // secondary ink (descriptions)
  muted: rgb(0.45, 0.48, 0.52), // grey labels / footer
  charcoal: rgb(0.114, 0.157, 0.192), // dark slate
  blue: rgb(0.114, 0.157, 0.192), // headings — now plain ink (was brand blue)
  red: rgb(0.35, 0.38, 0.42), // neutral grey (was option-chip red)
  accent: rgb(0.114, 0.157, 0.192), // thin rules / bars — now ink (was green)
  green: rgb(0.114, 0.157, 0.192), // ink (was green)
  greenDeep: rgb(0.114, 0.157, 0.192), // emphasis text — now ink (was deep green)
  greenSoft: rgb(0.931, 0.933, 0.941), // pale grey band (project / subheaders)
  accentSoft: rgb(0.949, 0.953, 0.961), // pale grey card highlight
  accentText: rgb(1, 1, 1), // retained for dead code; live bands use ink
  headFill: rgb(0.882, 0.886, 0.898), // grey table/summary header band
  tableHead: rgb(0.827, 0.867, 0.929), // #d3dded light steel-blue — particulars header highlight
  light: rgb(0.965, 0.968, 0.972), // very pale grey card
  border: rgb(0.78, 0.80, 0.83), // subtle dividers (footer, terms, signatures)
  borderStrong: rgb(0.55, 0.58, 0.62),
  // Near-black grid used for the particulars table, totals block and spec
  // cards so they read as a crisp bordered BOQ grid — kept separate from the
  // lighter `border` used for subtle dividers elsewhere.
  tableGrid: rgb(0.10, 0.12, 0.15), // near-black grid lines
  rowAlt: rgb(0.965, 0.968, 0.972), // light grey alternating row
  highlight: rgb(1, 0.953, 0.749), // #fff3bf highlighted value bg
  highlightText: rgb(0.478, 0.361, 0), // #7a5c00
  grandTotalBg: rgb(0.862, 0.866, 0.878), // grey grand-total band (was green)
  link: rgb(0.121, 0.278, 0.501), // muted navy — links stay recognisable
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
    y: yFromTop(ctx.y + 13),
    size: 13,
    font: ctx.bold,
    color: COL.blue,
  });
  ctx.y += 22;
  const subject = titleForSport(sport).replace(/^Quotation for\s+/i, "");
  drawText(ctx, subject, {
    x: MARGIN,
    size: 23,
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
  ensureSpace(ctx, 124);
  // From (left)
  safeDraw(ctx.page, "From", { x: MARGIN, y: yFromTop(s + 12), size: 13, font: ctx.bold, color: COL.blue });
  safeDraw(ctx.page, "Fitoverse Private Limited", { x: MARGIN, y: yFromTop(s + 33), size: 15, font: ctx.bold, color: COL.text });
  safeDraw(ctx.page, "Phone: 6381502055", { x: MARGIN, y: yFromTop(s + 51), size: 10.5, font: ctx.font, color: COL.textSoft });
  safeDraw(ctx.page, "GSTIN: 33AAECF8905G1ZQ", { x: MARGIN, y: yFromTop(s + 66), size: 10.5, font: ctx.font, color: COL.textSoft });
  // Seller street address, printed with the GSTIN in the header (wraps to the
  // left column's width so it never bleeds into the To / Quoted-on column).
  const addrLines = wordWrap(
    ctx.font,
    "Plot no 96, Samiyappa Nagar 3rd cross west street, Seelanaickenpatti, Salem, Tamil Nadu, 636201",
    9,
    colW - 10,
  );
  addrLines.forEach((ln, i) => {
    safeDraw(ctx.page, ln, { x: MARGIN, y: yFromTop(s + 81 + i * 11), size: 9, font: ctx.font, color: COL.muted });
  });
  // To (right)
  const rx = MARGIN + colW;
  safeDraw(ctx.page, "To", { x: rx, y: yFromTop(s + 12), size: 13, font: ctx.bold, color: COL.blue });
  safeDraw(ctx.page, toName, { x: rx, y: yFromTop(s + 33), size: 15, font: ctx.bold, color: COL.text });
  if (city) safeDraw(ctx.page, city, { x: rx, y: yFromTop(s + 50), size: 10.5, font: ctx.font, color: COL.textSoft });
  safeDraw(ctx.page, "Quoted on", { x: rx, y: yFromTop(s + 74), size: 13, font: ctx.bold, color: COL.blue });
  safeDraw(ctx.page, quoteDate, { x: rx, y: yFromTop(s + 94), size: 15, font: ctx.bold, color: COL.text });
  ctx.y = s + 124;
  space(ctx, 8);
}

function drawProjectLine(ctx: Ctx, sport: string, lengthFt: number, widthFt: number, city: string) {
  const h = 38;
  ensureSpace(ctx, h);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, h, { fill: COL.greenSoft });
  drawRect(ctx, MARGIN, ctx.y, 4, h, { fill: COL.accent });
  const area = lengthFt * widthFt;
  const prefix = "Project:  ";
  const detail = `${projectLabelForSport(sport)} - ${lengthFt} ft x ${widthFt} ft (${inr(area)} sq ft)${city ? ", " + city : ""}`;
  const baseY = yFromTop(ctx.y + 24);
  safeDraw(ctx.page, prefix, { x: MARGIN + 14, y: baseY, size: 13, font: ctx.bold, color: COL.blue });
  const px = MARGIN + 14 + safeWidth(ctx.bold, prefix, 13);
  safeDraw(ctx.page, detail, { x: px, y: baseY, size: 13, font: ctx.bold, color: COL.text });
  ctx.y += h;
  space(ctx, 10);
}

// Fetch + embed each line item's product photo. pdf-lib only embeds PNG/JPG
// natively; any other format (WEBP is common — phone/browser uploads and the
// MVPv2 catalogue import both produce it) is converted to PNG first via sharp
// so the photo still shows instead of silently vanishing. Any failure is
// still skipped so a broken URL/truly corrupt file never breaks the whole
// quote. Returns a map of item id -> embedded image (shared by the
// particulars-table row AND the spec card, so this one fix covers both).
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
      if (isPng(bytes)) img = await doc.embedPng(bytes);
      else if (isJpg(bytes)) img = await doc.embedJpg(bytes);
      else {
        const converted = await convertToPng(bytes);
        if (converted) img = await doc.embedPng(converted);
      }
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
  // Spans the full content width (matching the particulars table above it)
  // instead of a narrow box on the right — a right-aligned-only box left a
  // large empty gap on the left where the row visually had nothing in it.
  const totalsW = CONTENT_W;
  const x = MARGIN;
  const lineH = 22;
  const grandH = 32;
  const totalH = lineH * 2 + grandH;
  ensureSpace(ctx, totalH + 10);
  const top = ctx.y;

  const drawTotalRow = (label: string, value: string) => {
    safeDraw(ctx.page, label, {
      x: x + 10,
      y: yFromTop(ctx.y + 15),
      size: 12.5,
      font: ctx.font,
      color: COL.text,
    });
    const valW = safeWidth(ctx.bold, value, 12.5);
    safeDraw(ctx.page, value, {
      x: PAGE_W - MARGIN - valW - 10,
      y: yFromTop(ctx.y + 15),
      size: 12.5,
      font: ctx.bold,
      color: COL.text,
    });
    ctx.y += lineH;
  };

  drawTotalRow("Subtotal (without GST)", `₹ ${inr(subtotal)}`);
  drawLine(ctx, x, PAGE_W - MARGIN, COL.tableGrid, 0.7);
  drawTotalRow("GST Amount", `₹ ${inr(gst)}`);

  // Grand total band — plain grey with ink text — inside the same bordered block.
  drawLine(ctx, x, PAGE_W - MARGIN, COL.tableGrid, 0.7);
  drawRect(ctx, x, ctx.y, totalsW, grandH, { fill: COL.grandTotalBg });
  safeDraw(ctx.page, "Grand Total", {
    x: x + 10,
    y: yFromTop(ctx.y + 21),
    size: 14.5,
    font: ctx.bold,
    color: COL.text,
  });
  const grandText = `₹ ${inr(grandTotal)}`;
  const grandW = safeWidth(ctx.bold, grandText, 14.5);
  safeDraw(ctx.page, grandText, {
    x: PAGE_W - MARGIN - grandW - 10,
    y: yFromTop(ctx.y + 21),
    size: 14.5,
    font: ctx.bold,
    color: COL.text,
  });
  ctx.y += grandH;

  // Outer border wraps the whole block so it reads as one complete table
  // instead of loose floating text.
  ctx.page.drawRectangle({
    x,
    y: yFromTop(top + totalH),
    width: totalsW,
    height: totalH,
    borderColor: COL.tableGrid,
    borderWidth: 0.9,
  });
}

function drawSectionTitle(ctx: Ctx, title: string) {
  space(ctx, 10);
  ensureSpace(ctx, 32);
  // Coloured accent bar on the left + larger title for better visual rhythm
  drawRect(ctx, MARGIN, ctx.y + 1, 4, 20, { fill: COL.accent });
  safeDraw(ctx.page, title, {
    x: MARGIN + 12,
    y: yFromTop(ctx.y + 16),
    size: 17,
    font: ctx.bold,
    color: COL.blue,
  });
  ctx.y += 26;
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
    const wrapped = wordWrap(ctx.font, line, 12, CONTENT_W - 18);
    ensureSpace(ctx, wrapped.length * 15 + 2);
    // Bullet
    safeDraw(ctx.page, "•", {
      x: MARGIN + 6,
      y: yFromTop(ctx.y + 10),
      size: 12,
      font: ctx.font,
      color: COL.text,
    });
    // Text
    let lineY = ctx.y;
    for (const w of wrapped) {
      safeDraw(ctx.page, w, {
        x: MARGIN + 18,
        y: yFromTop(lineY + 10),
        size: 12,
        font: ctx.font,
        color: COL.text,
      });
      lineY += 15;
    }
    ctx.y = lineY + 2;
  }
}

function drawTerm(ctx: Ctx, title: string, body: string) {
  // Keep the whole clause (title + wrapped body) together — reserve its full
  // height so a numbered point never splits across a page break, leaving an
  // orphan line (e.g. point 6's tail) at the top of the next page.
  const titleH = 11.5 * 1.35;
  const bodyH = wordWrap(ctx.font, body, 11, CONTENT_W).length * (11 * 1.35);
  ensureSpace(ctx, titleH + bodyH + 5);
  drawText(ctx, title, { x: MARGIN, size: 11.5, bold: true });
  drawText(ctx, body, { x: MARGIN, size: 11, maxWidth: CONTENT_W, color: COL.text });
  space(ctx, 5);
}

function drawBankBlock(ctx: Ctx) {
  const blockH = 98;
  ensureSpace(ctx, blockH);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, blockH, { fill: COL.greenSoft, border: COL.border });
  const startY = ctx.y + 10;
  const rows = [
    ["Account Name", "FITOVERSE PVT LTD"],
    ["Bank Name", "HDFC BANK"],
    ["Branch", "BRINDHAVAN ROAD"],
    ["Account No", "50200066429411"],
    ["IFSC", "HDFC0001281"],
  ];
  rows.forEach(([label, value], i) => {
    const yTop = startY + i * 16;
    safeDraw(ctx.page, `${label}:`, {
      x: MARGIN + 12,
      y: yFromTop(yTop + 10),
      size: 11,
      font: ctx.bold,
      color: COL.text,
    });
    safeDraw(ctx.page, value, {
      x: MARGIN + 124,
      y: yFromTop(yTop + 10),
      size: 11,
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

// Plain government bill-of-quantities particulars table: an 8-column bordered
// grid — S.NO | ITEM | DESCRIPTION | UNIT | QTY | RATE | GST | AMOUNT — with a
// grey header band, near-black grid lines and plain sub-header rows per scope
// section. Item name and description live in separate columns (no in-table
// product photos — those reappear in the spec cards below the table).
//
// The `_images` map is retained in the signature (the caller shares it with the
// spec cards) but is intentionally unused here now that the table carries no
// photos.
//
// finalReserve: extra space to require alongside the LAST row specifically,
// matching whatever totals/comparison block is about to be drawn right
// after this table. Without it, the last row can fit snugly at a page's
// bottom while the totals that follow don't — landing the totals alone at
// the top of the next page with nothing to visually anchor them to.
function drawParticularsTable(
  ctx: Ctx,
  items: QuoteLineItem[],
  _images: Map<string, PDFImage>,
  finalReserve = 0,
) {
  // 8 columns; widths sum to CONTENT_W (S.NO narrowest, DESCRIPTION widest).
  const cols = { sno: 30, item: 112, desc: 156, unit: 34, qty: 46, rate: 52, gst: 30, amt: 63.28 };
  const x = {
    sno: MARGIN,
    item: MARGIN + cols.sno,
    desc: MARGIN + cols.sno + cols.item,
    unit: MARGIN + cols.sno + cols.item + cols.desc,
    qty: MARGIN + cols.sno + cols.item + cols.desc + cols.unit,
    rate: MARGIN + cols.sno + cols.item + cols.desc + cols.unit + cols.qty,
    gst: MARGIN + cols.sno + cols.item + cols.desc + cols.unit + cols.qty + cols.rate,
    amt: MARGIN + cols.sno + cols.item + cols.desc + cols.unit + cols.qty + cols.rate + cols.gst,
  };
  const rightEdge = MARGIN + CONTENT_W;
  const PAD = 5;
  // Table grid: outer left/right borders on every band + inner column
  // separators on data rows. Drawn per-band (using each band's own top/height)
  // so the grid survives page breaks. `inner` adds the column dividers.
  const innerXs = [x.item, x.desc, x.unit, x.qty, x.rate, x.gst, x.amt];
  const drawGrid = (top: number, h: number, inner: boolean) => {
    const yTop = yFromTop(top);
    const yBot = yFromTop(top + h);
    for (const vx of [MARGIN, rightEdge]) {
      ctx.page.drawLine({ start: { x: vx, y: yTop }, end: { x: vx, y: yBot }, color: COL.tableGrid, thickness: 0.9 });
    }
    if (inner) {
      for (const vx of innerXs) {
        ctx.page.drawLine({ start: { x: vx, y: yTop }, end: { x: vx, y: yBot }, color: COL.tableGrid, thickness: 0.6 });
      }
    }
  };
  const rowLine = (top: number, thickness = 0.6) => {
    ctx.page.drawLine({ start: { x: MARGIN, y: yFromTop(top) }, end: { x: rightEdge, y: yFromTop(top) }, color: COL.tableGrid, thickness });
  };
  const leftAt = (t: string, cx0: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, y: number) => {
    safeDraw(ctx.page, t, { x: cx0 + PAD, y, size, font, color });
  };
  const centerAt = (t: string, cx0: number, cw: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, y: number) => {
    const w = safeWidth(font, t, size);
    safeDraw(ctx.page, t, { x: cx0 + (cw - w) / 2, y, size, font, color });
  };
  const rightAt = (t: string, cx0: number, cw: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, y: number) => {
    const w = safeWidth(font, t, size);
    safeDraw(ctx.page, t, { x: cx0 + cw - w - PAD, y, size, font, color });
  };
  // ── Readable base type sizes (pt). The whole table renders at one `scale`
  // (<=1) chosen below so the particulars rows PLUS the totals block always end
  // within 2 pages — never a 3rd — while staying as large/readable as possible.
  // 5–10 long-description items is the target; short quotes stay at 1.0 and
  // simply finish early (we never pad to fill the second page).
  const B = {
    head: 10,
    name: 10.5, nameLH: 13,
    opt: 9, optLH: 11.5,
    desc: 10, descLH: 12.5,
    sec: 11, secLH: 13.5,
    headerH: 24,
    padTop: 4, padBot: 4,
  };
  const FLOOR = 0.85; // description never shrinks below ~8.5pt (the prior size)
  const BOTTOM = PAGE_H - MARGIN - FOOTER_RESERVE; // same limit ensureSpace uses
  // Continuation pages restart below the top-left logo (newPage adds MARGIN +
  // logo height (<=34) + 14). Use the max height so the estimate never predicts
  // fewer pages than the real render.
  const CONT_START = MARGIN + 34 + 14;

  // Group rows by scope section (stable sort preserves within-section order).
  const ordered = [...items].sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section));
  const inc = ordered.filter((i) => i.included);

  // Measure each row's height at a candidate scale WITHOUT drawing — larger
  // fonts wrap to more lines, so wrapping is re-run per scale. MUST mirror the
  // draw loop's height math exactly, or the page prediction drifts.
  const measureRows = (s: number): number[] => {
    let lastSec: string | null = null;
    return inc.map((item) => {
      const sec = item.section ?? null;
      const isNew = !!sec && sec !== lastSec;
      const secLines = isNew ? wordWrap(ctx.bold, sec as string, B.sec * s, cols.item - PAD * 2) : [];
      const nameLines = wordWrap(ctx.bold, item.name, B.name * s, cols.desc - PAD * 2);
      const descLines = wordWrap(ctx.font, item.description, B.desc * s, cols.desc - PAD * 2);
      const itemColH = secLines.length * B.secLH * s;
      const descColH =
        nameLines.length * B.nameLH * s + (item.optionTag ? B.optLH * s : 0) + descLines.length * B.descLH * s;
      if (sec) lastSec = sec;
      return B.padTop * s + Math.max(itemColH, descColH, B.nameLH * s) + B.padBot * s;
    });
  };

  // Page count at a scale, mirroring ensureSpace's break math (header re-emitted
  // on each page; the totals reserve rides the final row).
  const simulatePages = (s: number): number => {
    const rows = measureRows(s);
    const headH = B.headerH * s;
    let page = 1;
    let yy = ctx.y + headH; // header consumed on the table's first page
    for (let i = 0; i < rows.length; i++) {
      const reserve = i === rows.length - 1 ? finalReserve : 0;
      if (yy + rows[i] + reserve > BOTTOM) {
        page += 1;
        yy = CONT_START + headH;
      }
      yy += rows[i];
    }
    return page;
  };

  // Largest readable scale whose table (incl. totals reserve) ends by page 2.
  let scale = 1;
  while (scale > FLOOR && simulatePages(scale) > 2) scale -= 0.02;

  const HEAD_SIZE = B.head * scale;
  const headerH = B.headerH * scale;
  const NAME_SIZE = B.name * scale;
  const NAME_LH = B.nameLH * scale;
  const OPT_SIZE = B.opt * scale;
  const OPT_LH = B.optLH * scale;
  const DESC_SIZE = B.desc * scale;
  const DESC_LH = B.descLH * scale;
  const SEC_SIZE = B.sec * scale;
  const SEC_LH = B.secLH * scale;
  const PADTOP = B.padTop * scale;
  const PADBOT = B.padBot * scale;

  const drawHead = () => {
    ensureSpace(ctx, headerH);
    drawRect(ctx, MARGIN, ctx.y, CONTENT_W, headerH, { fill: COL.tableHead });
    const hy = yFromTop(ctx.y + headerH * 0.68);
    centerAt("S.NO", x.sno, cols.sno, HEAD_SIZE, ctx.bold, COL.text, hy);
    leftAt("ITEM", x.item, HEAD_SIZE, ctx.bold, COL.text, hy);
    leftAt("DESCRIPTION", x.desc, HEAD_SIZE, ctx.bold, COL.text, hy);
    centerAt("UNIT", x.unit, cols.unit, HEAD_SIZE, ctx.bold, COL.text, hy);
    rightAt("QTY", x.qty, cols.qty, HEAD_SIZE, ctx.bold, COL.text, hy);
    rightAt("RATE", x.rate, cols.rate, HEAD_SIZE, ctx.bold, COL.text, hy);
    centerAt("GST", x.gst, cols.gst, HEAD_SIZE, ctx.bold, COL.text, hy);
    rightAt("AMOUNT", x.amt, cols.amt, HEAD_SIZE, ctx.bold, COL.text, hy);
    rowLine(ctx.y, 0.9);
    drawGrid(ctx.y, headerH, true);
    rowLine(ctx.y + headerH, 0.9);
    ctx.y += headerH;
  };
  drawHead();
  let lastSection: string | null = null;
  let serial = 0;
  for (let idx = 0; idx < inc.length; idx++) {
    const item = inc[idx];
    const sec = item.section ?? null;
    const isNewSection = !!sec && sec !== lastSection;
    // ITEM column carries the SECTION title (shown once per section group);
    // DESCRIPTION column carries the item name (bold) + option + spec text.
    const secLines = isNewSection ? wordWrap(ctx.bold, sec as string, SEC_SIZE, cols.item - PAD * 2) : [];
    const nameLines = wordWrap(ctx.bold, item.name, NAME_SIZE, cols.desc - PAD * 2);
    const descLines = wordWrap(ctx.font, item.description, DESC_SIZE, cols.desc - PAD * 2);
    const hasOpt = !!item.optionTag;
    const itemColH = secLines.length * SEC_LH;
    const descColH = nameLines.length * NAME_LH + (hasOpt ? OPT_LH : 0) + descLines.length * DESC_LH;
    const rowH = PADTOP + Math.max(itemColH, descColH, NAME_LH) + PADBOT;
    // Only the truly last row drags the totals block's reserve along with it.
    const reserve = idx === inc.length - 1 ? finalReserve : 0;

    const pb = ctx.pageNumber;
    ensureSpace(ctx, rowH + reserve);
    if (ctx.pageNumber !== pb) drawHead();

    serial++;
    if (serial % 2 === 0) drawRect(ctx, MARGIN, ctx.y, CONTENT_W, rowH, { fill: COL.rowAlt });
    const sy = ctx.y + PADTOP;
    const line0 = sy + NAME_SIZE; // first-line baseline (distance from row top)
    const numY = yFromTop(line0);
    // S.NO
    centerAt(String(serial), x.sno, cols.sno, NAME_SIZE, ctx.font, COL.text, numY);
    // ITEM = section title (only on the first row of each section)
    secLines.forEach((ln, i) => {
      safeDraw(ctx.page, ln, { x: x.item + PAD, y: yFromTop(sy + SEC_SIZE + i * SEC_LH), size: SEC_SIZE, font: ctx.bold, color: COL.text });
    });
    // DESCRIPTION = item name (bold) + option + description, stacked.
    nameLines.forEach((ln, i) => {
      safeDraw(ctx.page, ln, { x: x.desc + PAD, y: yFromTop(line0 + i * NAME_LH), size: NAME_SIZE, font: ctx.bold, color: COL.text });
    });
    let below = sy + nameLines.length * NAME_LH; // top of the next stacked element
    if (hasOpt) {
      safeDraw(ctx.page, `Option ${item.optionTag}`, { x: x.desc + PAD, y: yFromTop(below + OPT_SIZE), size: OPT_SIZE, font: ctx.font, color: COL.muted });
      below += OPT_LH;
    }
    descLines.forEach((ln, i) => {
      safeDraw(ctx.page, ln, { x: x.desc + PAD, y: yFromTop(below + DESC_SIZE + i * DESC_LH), size: DESC_SIZE, font: ctx.font, color: COL.text });
    });
    // Numeric cells, aligned to the first line.
    const amt = item.areaSqFt * item.ratePerSqFt;
    centerAt(item.unit ?? "sq.ft", x.unit, cols.unit, NAME_SIZE, ctx.font, COL.text, numY);
    rightAt(inr(item.areaSqFt), x.qty, cols.qty, NAME_SIZE, ctx.font, COL.text, numY);
    rightAt(inrRate(item.ratePerSqFt), x.rate, cols.rate, NAME_SIZE, ctx.font, COL.text, numY);
    centerAt(gstLabel(item.gstPercent), x.gst, cols.gst, NAME_SIZE, ctx.font, COL.text, numY);
    rightAt(inr(amt), x.amt, cols.amt, NAME_SIZE, ctx.bold, COL.text, numY);

    // Section grouping: a BOLD dark rule only where the section CHANGES (or the
    // table ends); a light rule between items INSIDE one section, so a section
    // reads as one grouped block (a continuation row like LED under "Fencing &
    // Fixtures" is never cut off from its section title by a dark line).
    const nextSec = idx + 1 < inc.length ? (inc[idx + 1].section ?? null) : null;
    const sectionEndsHere = idx === inc.length - 1 || nextSec !== sec;
    drawGrid(ctx.y, rowH, true);
    rowLine(ctx.y + rowH, sectionEndsHere ? 1.3 : 0.4);
    ctx.y += rowH;
    if (sec) lastSection = sec;
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
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, headerH, { fill: COL.headFill, border: COL.tableGrid, borderWidth: 0.9 });
  safeDraw(ctx.page, "Amount Details", { x: MARGIN + 8, y: yFromTop(ctx.y + 19), size: 9, font: ctx.bold, color: COL.text });
  opts.forEach((o, i) => {
    const cx = MARGIN + labelW + i * optW;
    const t1 = `Option ${o.optionTag}`;
    const w1 = safeWidth(ctx.bold, t1, 9);
    safeDraw(ctx.page, t1, { x: cx + optW - w1 - 8, y: yFromTop(ctx.y + 13), size: 9, font: ctx.bold, color: COL.text });
    let sub = o.optionShort ?? o.name ?? "";
    while (sub.length > 3 && safeWidth(ctx.font, sub, 7) > optW - 14) sub = sub.slice(0, -1);
    const w2 = safeWidth(ctx.font, sub, 7);
    safeDraw(ctx.page, sub, { x: cx + optW - w2 - 8, y: yFromTop(ctx.y + 25), size: 7, font: ctx.font, color: COL.muted });
  });
  ctx.y += headerH;
  const rowH = 20;
  const drawRow = (label: string, valueFor: (o: QuoteLineItem) => number, o2: { bold?: boolean; band?: boolean } = {}) => {
    const h = o2.band ? rowH + 4 : rowH;
    if (o2.band) drawRect(ctx, MARGIN, ctx.y, CONTENT_W, h, { fill: COL.grandTotalBg });
    const ty = yFromTop(ctx.y + (o2.band ? 16 : 13));
    const size = o2.bold ? 10 : 9;
    const font = o2.bold ? ctx.bold : ctx.font;
    const col = COL.text;
    safeDraw(ctx.page, label, { x: MARGIN + 8, y: ty, size, font, color: col });
    opts.forEach((o, i) => {
      const cx = MARGIN + labelW + i * optW;
      const v = inr(valueFor(o));
      const w = safeWidth(font, v, size);
      safeDraw(ctx.page, v, { x: cx + optW - w - 8, y: ty, size, font, color: col });
    });
    if (o2.band) {
      ctx.page.drawLine({ start: { x: MARGIN, y: yFromTop(ctx.y + h) }, end: { x: PAGE_W - MARGIN, y: yFromTop(ctx.y + h) }, color: COL.tableGrid, thickness: 0.9 });
    } else {
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

// Height of the FIRST row of spec cards (mirrors drawSpecCards' own per-row
// math). Used at the call site to reserve space for the section title
// TOGETHER with its first row, so a title that just barely fits at a page's
// bottom doesn't leave its card(s) stranded on the next page — most visible
// with a single/solo product, where there's only one row to begin with.
function firstSpecCardRowHeight(
  ctx: Ctx,
  items: QuoteLineItem[],
  images: Map<string, PDFImage>,
): number {
  const gap = 12;
  const topPad = 14;
  const columns = Math.min(items.length, 3) || 1;
  const cardW = (CONTENT_W - gap * (columns - 1)) / columns;
  const bulletSize = 9.5;
  const lh = 14;
  const imgMaxW = cardW - 24;
  const imgMaxH = 96;
  let maxLines = 0;
  let maxImgH = 0;
  for (const it of items.slice(0, columns)) {
    let lines = 0;
    for (const s of it.specs ?? []) {
      lines += wordWrap(ctx.bold, `${s.label}: ${s.value}`, bulletSize, cardW - 26).length;
    }
    maxLines = Math.max(maxLines, lines);
    const img = images.get(it.id);
    if (img) {
      const sc = Math.min(imgMaxW / img.width, imgMaxH / img.height, 1);
      maxImgH = Math.max(maxImgH, img.height * sc);
    }
  }
  const imgBlock = maxImgH > 0 ? maxImgH + 10 : 0;
  return topPad + imgBlock + 20 + maxLines * lh + 12;
}

// Spec cards (product photo + title + bullet specs), one per product. Laid out
// up to three side-by-side, wrapping to further rows when more than three
// products carry specs — so a single product shows one card and N products
// show N cards. The card photo reuses the same embedded image map the
// particulars table uses (keyed by line-item id).
function drawSpecCards(ctx: Ctx, items: QuoteLineItem[], images: Map<string, PDFImage>) {
  const gap = 12;
  const topPad = 14;
  const columns = Math.min(items.length, 3) || 1;
  const cardW = (CONTENT_W - gap * (columns - 1)) / columns;
  const titleSize = 11;
  const bulletSize = 9.5;
  const lh = 14;
  const imgMaxW = cardW - 24;
  const imgMaxH = 96;
  const prepared = items.map((it) => {
    const lines: string[] = [];
    for (const s of it.specs ?? []) {
      const wrapped = wordWrap(ctx.bold, `${s.label}: ${s.value}`, bulletSize, cardW - 26);
      wrapped.forEach((w, idx) => lines.push((idx === 0 ? "- " : "  ") + w));
    }
    const img = images.get(it.id) ?? null;
    let imgW = 0;
    let imgH = 0;
    if (img) {
      const sc = Math.min(imgMaxW / img.width, imgMaxH / img.height, 1);
      imgW = img.width * sc;
      imgH = img.height * sc;
    }
    return { it, lines, img, imgW, imgH };
  });
  // Render in rows of `columns`; each row's height fits its tallest card, and
  // the photo band height is shared so titles align across the row.
  for (let r = 0; r < prepared.length; r += columns) {
    const rowCards = prepared.slice(r, r + columns);
    const maxLines = rowCards.reduce((m, c) => Math.max(m, c.lines.length), 0);
    const maxImgH = rowCards.reduce((m, c) => Math.max(m, c.imgH), 0);
    const imgBlock = maxImgH > 0 ? maxImgH + 10 : 0;
    const cardH = topPad + imgBlock + 20 + maxLines * lh + 12;
    ensureSpace(ctx, cardH + 6);
    const top = ctx.y;
    rowCards.forEach((c, i) => {
      const cx = MARGIN + i * (cardW + gap);
      drawRect(ctx, cx, top, cardW, cardH, { fill: rgb(1, 1, 1), border: COL.tableGrid, borderWidth: 0.9 });
      // Product photo, centred at the top of the card (with a thin frame).
      if (c.img) {
        const ix = cx + (cardW - c.imgW) / 2;
        const iy = top + topPad;
        ctx.page.drawImage(c.img, { x: ix, y: yFromTop(iy + c.imgH), width: c.imgW, height: c.imgH });
        ctx.page.drawRectangle({ x: ix, y: yFromTop(iy + c.imgH), width: c.imgW, height: c.imgH, borderColor: COL.tableGrid, borderWidth: 0.75 });
      }
      // Title + specs sit below the shared photo band so rows line up.
      const titleTop = top + topPad + imgBlock;
      let title = c.it.optionShort ?? c.it.name ?? "";
      while (title.length > 4 && safeWidth(ctx.bold, title, titleSize) > cardW - 20) title = title.slice(0, -1);
      safeDraw(ctx.page, title, { x: cx + 12, y: yFromTop(titleTop + titleSize), size: titleSize, font: ctx.bold, color: COL.blue });
      let yy = titleTop + 20;
      for (const ln of c.lines) {
        safeDraw(ctx.page, ln, { x: cx + 12, y: yFromTop(yy + 8), size: bulletSize, font: ctx.bold, color: COL.text });
        yy += lh;
      }
    });
    ctx.y = top + cardH;
    space(ctx, 6);
  }
}

// Total height a numbered list will take (mirrors drawNumbered's own
// per-item math). Exposed so a caller can reserve it TOGETHER with a
// preceding section title (see the Notes call site) — otherwise the title
// alone can fit at a page's bottom while the whole list it introduces gets
// pushed to the next page on its own.
function numberedListHeight(ctx: Ctx, lines: string[]): number {
  return lines.reduce((h, line) => h + wordWrap(ctx.font, line, 12, CONTENT_W - 28).length * 15 + 2, 0);
}

// Total height a drawBullets() list will consume — mirrors its own wrapping so
// a heading can be reserved TOGETHER with its bullets (no orphaned subheading).
function bulletsHeight(ctx: Ctx, lines: string[]): number {
  return lines.reduce((h, line) => h + wordWrap(ctx.font, line, 12, CONTENT_W - 18).length * 15 + 2, 0);
}

function drawNumbered(ctx: Ctx, lines: string[]) {
  // Wrap everything up front and reserve the WHOLE list's height in one
  // ensureSpace call — otherwise each item is paginated independently, so a
  // page boundary falling mid-list orphans the first item(s) alone at the
  // bottom of one page while the rest spill to the next. Reserving the full
  // block keeps the list together, pushing all of it to a new page instead.
  const wrapped = lines.map((line) => wordWrap(ctx.font, line, 12, CONTENT_W - 28));
  ensureSpace(ctx, numberedListHeight(ctx, lines));
  lines.forEach((line, i) => {
    const num = `${i + 1}.`;
    safeDraw(ctx.page, num, { x: MARGIN + 4, y: yFromTop(ctx.y + 10), size: 12, font: ctx.font, color: COL.text });
    let ly = ctx.y;
    for (const w of wrapped[i]) {
      safeDraw(ctx.page, w, { x: MARGIN + 22, y: yFromTop(ly + 10), size: 12, font: ctx.font, color: COL.text });
      ly += 15;
    }
    ctx.y = ly + 2;
  });
}

function drawSubheading(ctx: Ctx, title: string) {
  space(ctx, 6);
  ensureSpace(ctx, 22);
  safeDraw(ctx.page, title, { x: MARGIN, y: yFromTop(ctx.y + 13), size: 13.5, font: ctx.bold, color: COL.blue });
  ctx.y += 22;
}

function drawPaymentTerms(ctx: Ctx, sport: string) {
  const parts: Array<[string, string]> = [
    ["50%", "advance during purchase order"],
    ["30%", "during flooring work"],
    ["15%", `after ${installationMilestone(sport)}`],
    ["5%", "after completion of work"],
  ];
  for (const [pct, rest] of parts) {
    ensureSpace(ctx, 19);
    safeDraw(ctx.page, pct, { x: MARGIN + 4, y: yFromTop(ctx.y + 11), size: 12.5, font: ctx.bold, color: COL.green });
    const pw = safeWidth(ctx.bold, pct, 12.5);
    safeDraw(ctx.page, "  " + rest, { x: MARGIN + 4 + pw, y: yFromTop(ctx.y + 11), size: 12.5, font: ctx.font, color: COL.text });
    ctx.y += 19;
  }
}

// ── Phase F: full-page "The Fitoverse Advantage" ──
function drawAdvantagePage(ctx: Ctx) {
  const paras = [
    "Fitoverse Sports Infra is synonymous with world-class sports construction. We bridge the gap between natural playability and modern engineering, offering surfaces that replicate the best qualities of natural fields while significantly reducing maintenance costs and eliminating game cancellations due to weather or uneven terrain.",
    "We pride ourselves on being a single-source provider. When you partner with Fitoverse, you engage a team capable of handling the entire project lifecycle - from planning, design, and subfloor construction to professional lighting and precision installation.",
    "Our commitment to quality is validated by our adherence to the rigorous standards set by global governing bodies, including FIFA, World Rugby, FIH, ITF, and FIBA.",
  ];
  const cardW = (CONTENT_W - 16) / 2;
  const cardH = 74;
  const statH = 66;
  // Reserve the WHOLE section up front so it moves to a fresh page as one
  // unit. Nothing inside must split — a lone stat band orphaning onto a
  // near-empty page is exactly the "one line on page 6" bug we're fixing.
  // We want only continuous information in the quotation, never a stub page.
  const paraLH = 11 * 1.35;
  let parasH = 0;
  for (const p of paras) {
    parasH += wordWrap(ctx.font, p, 11, CONTENT_W).length * paraLH + 8;
  }
  const sectionH = 6 + 30 + 16 + parasH + 14 + cardH + 18 + statH;
  ensureSpace(ctx, sectionH);

  space(ctx, 6);
  safeDraw(ctx.page, "The Fitoverse Advantage", { x: MARGIN, y: yFromTop(ctx.y + 22), size: 24, font: ctx.bold, color: COL.text });
  ctx.y += 30;
  ctx.page.drawLine({ start: { x: MARGIN, y: yFromTop(ctx.y) }, end: { x: MARGIN + 64, y: yFromTop(ctx.y) }, color: COL.accent, thickness: 2.5 });
  space(ctx, 16);
  for (const p of paras) {
    drawText(ctx, p, { x: MARGIN, size: 11, maxWidth: CONTENT_W, color: COL.text });
    space(ctx, 8);
  }
  space(ctx, 14);
  const top = ctx.y;
  drawRect(ctx, MARGIN, top, cardW, cardH, { fill: COL.light, border: COL.border });
  drawCentered(ctx, "PROUD MEMBERS OF", MARGIN, cardW, top + 16, 11, ctx.bold, COL.text);
  drawCentered(ctx, "IAKS   ·   SFBA India", MARGIN, cardW, top + 42, 14, ctx.bold, COL.green);
  const c2 = MARGIN + cardW + 16;
  drawRect(ctx, c2, top, cardW, cardH, { fill: COL.light, border: COL.border });
  drawCentered(ctx, "WE USE FLOORINGS AUTHORIZED BY", c2, cardW, top + 16, 11, ctx.bold, COL.text);
  drawCentered(ctx, "FIFA Quality   ·   FIFA Quality Pro", c2, cardW, top + 42, 14, ctx.bold, COL.green);
  ctx.y = top + cardH;
  space(ctx, 18);
  drawRect(ctx, MARGIN, ctx.y, CONTENT_W, statH, { fill: COL.greenSoft });
  const statTop = ctx.y;
  const halfW = CONTENT_W / 2;
  drawCentered(ctx, "65+", MARGIN, halfW, statTop + 18, 28, ctx.bold, COL.green);
  drawCentered(ctx, "infra projects", MARGIN, halfW, statTop + 46, 11, ctx.font, COL.muted);
  drawCentered(ctx, "4 Lakh+", MARGIN + halfW, halfW, statTop + 18, 28, ctx.bold, COL.green);
  drawCentered(ctx, "Sq. Ft. Covered", MARGIN + halfW, halfW, statTop + 46, 11, ctx.font, COL.muted);
  ctx.y += statH;
}

// ── Phase F.5: "Our Portfolio" section (real photo + portfolio link).
//    Drawn on the SAME page as "Connect With Us" (see render entry). Only
//    drawn when a photo exists for the sport. Compact so both fit one page. ──
function drawShowcaseSection(
  ctx: Ctx,
  photo: PDFImage,
  driveLink: string | null,
) {
  space(ctx, 8);
  drawCentered(ctx, "Our Portfolio", MARGIN, CONTENT_W, ctx.y, 18, ctx.bold, COL.text);
  ctx.y += 24;
  ctx.page.drawLine({
    start: { x: (PAGE_W - 64) / 2, y: yFromTop(ctx.y) },
    end: { x: (PAGE_W + 64) / 2, y: yFromTop(ctx.y) },
    color: COL.accent,
    thickness: 2.5,
  });
  space(ctx, 16);

  const maxW = 380;
  const maxH = 200;
  const scale = Math.min(maxW / photo.width, maxH / photo.height, 1);
  const w = photo.width * scale;
  const h = photo.height * scale;
  const px = (PAGE_W - w) / 2;
  ctx.page.drawImage(photo, { x: px, y: yFromTop(ctx.y + h), width: w, height: h });
  ctx.page.drawRectangle({
    x: px,
    y: yFromTop(ctx.y + h),
    width: w,
    height: h,
    borderColor: COL.border,
    borderWidth: 1,
  });
  ctx.y += h;
  space(ctx, 12);

  // Always show a portfolio link. A per-project drive link (from the
  // project_drive_link_<sport> setting) wins; otherwise link to the website.
  const link = driveLink || "https://fitoverse.com/";
  const label = driveLink
    ? "View more photos & videos of this project"
    : "View our full project portfolio";
  const size = 11.5;
  const linkW = safeWidth(ctx.font, label, size);
  drawLink(ctx, label, link, { x: (PAGE_W - linkW) / 2, size });
  ctx.y += size * 1.4;
  space(ctx, 18);
}

// ── Phase G: "Connect With Us" — shares the final page with Our Portfolio ──
function drawConnectPage(ctx: Ctx, driveLink: string | null = null) {
  space(ctx, 10);
  drawCentered(ctx, "Connect With Us", MARGIN, CONTENT_W, ctx.y, 18, ctx.bold, COL.text);
  ctx.y += 26;
  drawCentered(ctx, "Reach out for a site visit, a detailed quote, or a walkthrough of our work.", MARGIN, CONTENT_W, ctx.y, 10, ctx.font, COL.muted);
  ctx.y += 28;
  const rows: Array<[string, string, string | null]> = [
    ["Phone", "+91 63815 02055   ·   +91 93638 63382", null],
    ["Portfolio", "View our projects", driveLink || "https://fitoverse.com/"],
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
    safeDraw(ctx.page, label, { x: px + 24, y: yFromTop(ry + 10), size: 10, font: ctx.bold, color: COL.blue });
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
  // Project drive link for the showcase page — resolved by the caller from
  // Setting key project_drive_link_<sport> (see attach-catalogue.ts's
  // pattern). The page itself only renders when a photo also exists for
  // this sport in SHOWCASE_PHOTO_BYTES, so a link with no photo is a no-op.
  driveLink?: string | null;
};

// Sample-style COVER PAGE (page 1): company header top-right, big centered
// logo, the TO block (project subject in green + customer/city below), the
// "From FITOVERSE…" block, and the date. The accent green/blue here match the
// sample cover; the body/table stays plain. Absolute-Y layout (not the ctx.y
// cursor) since it's a one-off page.
function drawCoverPage(
  ctx: Ctx,
  data: QuotationPdfData,
  quoteDate: string,
  logoImage: PDFImage | null,
  boldItalic: PDFFont,
) {
  const GREEN = rgb(0x15 / 255, 0x93 / 255, 0x41 / 255);
  const BLUE = rgb(0x2e / 255, 0x9b / 255, 0xd6 / 255);
  const rightX = MARGIN + CONTENT_W;
  const centerText = (t: string, topY: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) => {
    const w = safeWidth(font, t, size);
    safeDraw(ctx.page, t, { x: MARGIN + (CONTENT_W - w) / 2, y: yFromTop(topY + size), size, font, color });
  };

  // Company details, top-right (right-aligned).
  const headerLines = [
    "Plot no 96, Samiyappa Nagar 3rd cross west street,",
    "Seelanaickenpatti, Salem, Tamil Nadu, Pincode: 636201",
    "Phone: 9894570997, 9597766524",
    "GSTIN: 33AAECF8905G1ZQ",
    "CIN: U92490TZ2022PTC038004",
  ];
  let hy = MARGIN;
  for (const ln of headerLines) {
    const w = safeWidth(ctx.font, ln, 9);
    safeDraw(ctx.page, ln, { x: rightX - w, y: yFromTop(hy + 9), size: 9, font: ctx.font, color: COL.textSoft });
    hy += 12.5;
  }
  // Letterhead logo, top-left — balances the company block on the right.
  if (logoImage) {
    const lf = logoImage.scaleToFit(140, 46);
    ctx.page.drawImage(logoImage, { x: MARGIN, y: yFromTop(MARGIN + lf.height), width: lf.width, height: lf.height });
  }
  const ruleY = yFromTop(hy + 8);
  ctx.page.drawLine({ start: { x: MARGIN, y: ruleY }, end: { x: rightX, y: ruleY }, color: COL.text, thickness: 1 });

  // Big centered logo.
  if (logoImage) {
    const f = logoImage.scaleToFit(260, 92);
    ctx.page.drawImage(logoImage, {
      x: MARGIN + (CONTENT_W - f.width) / 2,
      y: yFromTop(200 + f.height),
      width: f.width,
      height: f.height,
    });
  } else {
    centerText("FIT O VERSE", 210, 28, ctx.bold, GREEN);
  }

  // TO block — project subject (green italic) + customer/city (dark italic).
  const subject = titleForSport(data.sport).replace(/^Quotation for\s+/i, "");
  const projectLine = `${subject} - ${data.lengthFt} ft x ${data.widthFt} ft`.toUpperCase();
  const parts = (data.customerName ?? "").split(",");
  const toName = (parts[0] ?? "").trim();
  const city = parts.slice(1).join(",").trim();
  const customerLine = (toName + (city ? ` - ${city}` : "")).toUpperCase().trim();
  centerText(projectLine, 318, 15, boldItalic, GREEN);
  if (customerLine) centerText(customerLine, 344, 13, boldItalic, COL.text);

  // From block, centered.
  centerText("From", 438, 13, ctx.bold, COL.text);
  {
    const a = "FITOVERSE ";
    const b = "PRIVATE LIMITED";
    const wa = safeWidth(ctx.bold, a, 14);
    const wb = safeWidth(ctx.bold, b, 14);
    const startX = MARGIN + (CONTENT_W - (wa + wb)) / 2;
    const fy = yFromTop(456 + 14);
    safeDraw(ctx.page, a, { x: startX, y: fy, size: 14, font: ctx.bold, color: COL.text });
    safeDraw(ctx.page, b, { x: startX + wa, y: fy, size: 14, font: ctx.bold, color: COL.text });
  }
  centerText("Plot no 96, Samiyappa Nagar 3rd cross west street,", 478, 10, ctx.font, COL.textSoft);
  centerText("Seelanaickenpatti, Salem, Tamil Nadu, 636201", 491, 10, ctx.font, COL.textSoft);
  centerText("Phone: 9894570997, 9597766524", 504, 10, ctx.font, COL.textSoft);

  // "Quoted On" section — styled to match the "From" title above (bold dark
  // title with its value directly below).
  centerText("Quoted On", 552, 13, ctx.bold, COL.text);
  centerText(quoteDate, 570, 14, ctx.bold, COL.text);
}

export async function renderQuotationPdf(data: QuotationPdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation ${data.number}`);
  doc.setAuthor("Fitoverse Private Limited");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

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

  const quoteDateStr = data.quoteDate
    .toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    .replace(/\//g, " / ");

  // ── PAGE 1: sample-style cover (logo + project + From + date) ──
  drawCoverPage(ctx, data, quoteDateStr, logoImage, boldItalic);

  // ── PAGE 2+: line items, totals, notes ──
  newPage(ctx);
  space(ctx, 6);
  const hasOptions = anyOptions(data.lineItems);
  drawSectionTitle(ctx, "Commercial Quotation");
  const itemImages = await embedLineItemImages(doc, data.lineItems);
  // Matches drawComparisonTable's / drawTotals' own ensureSpace() cost (with a
  // little headroom) — see drawParticularsTable's finalReserve doc comment.
  const totalsReserve = hasOptions ? 185 : 105;
  drawParticularsTable(ctx, data.lineItems, itemImages, totalsReserve);
  if (hasOptions) drawComparisonTable(ctx, data.lineItems);
  else drawTotals(ctx, data.subtotal, data.gstAmount, data.grandTotal);

  // Specifications (only when items carry structured specs)
  const specItems = data.lineItems.filter((i) => i.included && i.specs && i.specs.length);
  if (specItems.length) {
    // Reserve space for the section title TOGETHER with its first row of
    // cards (34 = drawSectionTitle's own vertical consumption: space(10) +
    // 18 + space(6)) — otherwise a title that just fits at a page's bottom
    // leaves the card(s) stranded on the next page. Solo products are the
    // most visible case since there's only one row to keep together.
    ensureSpace(ctx, 34 + firstSpecCardRowHeight(ctx, specItems, itemImages));
    drawSectionTitle(ctx, specSectionTitle(data.sport));
    drawSpecCards(ctx, specItems, itemImages);
  }

  // Notes / Client Work Scope / Payment Terms + bank
  const notesLines = [
    "Installation charges are included in the above rates.",
    "GST is charged extra as shown; ground preparation carries no GST.",
    "Freight / transport charges extra for materials at actuals.",
    "Client's scope: levelled ground to be provided; power, water and handling support at site.",
    "Food and stay for the installation team on client scope.",
    "Unloading, shifting and storage at the project site on client scope.",
    "Warranty as applicable to the selected surface, excluding damage from misuse, vandalism or natural calamities.",
  ];
  // Reserve the title TOGETHER with the whole list (34 = drawSectionTitle's
  // own vertical consumption) — otherwise the title alone can fit at a
  // page's bottom while the list it introduces gets pushed to the next page
  // by itself.
  ensureSpace(ctx, 34 + numberedListHeight(ctx, notesLines));
  drawSectionTitle(ctx, "Notes");
  drawNumbered(ctx, notesLines);
  const clientScope = [
    "Site to be ready, clean and levelled before commencement.",
    "Power, water, unloading, shifting and storage support at site.",
    "Food and stay for the installation team.",
  ];
  // Keep the "Client Work Scope" heading together with its bullets — a heading
  // must never sit alone at a page bottom with its list on the next page
  // (6 + 19 = drawSubheading's own space(6) + height).
  ensureSpace(ctx, 6 + 19 + bulletsHeight(ctx, clientScope));
  drawSubheading(ctx, "Client Work Scope");
  drawBullets(ctx, clientScope);
  // Keep the whole Payment Terms block together (title + milestone lines +
  // the RTGS note + the bank-details box) so it never splits across a page.
  ensureSpace(ctx, 220);
  drawSectionTitle(ctx, "Payment Terms");
  drawPaymentTerms(ctx, data.sport);
  space(ctx, 4);
  drawText(ctx, "Payment by Demand Draft or At-Par Cheque in favour of FITOVERSE PRIVATE LIMITED. For RTGS/NEFT:", { x: MARGIN, size: 10, maxWidth: CONTENT_W });
  space(ctx, 6);
  drawBankBlock(ctx);

  if (data.notes && data.notes.trim()) {
    // Reserve the heading + its first two lines so it can't orphan at a
    // page bottom with the note text starting on the next page.
    ensureSpace(ctx, 6 + 19 + 10 * 1.35 * 2);
    drawSubheading(ctx, "Additional Notes");
    drawText(ctx, data.notes.trim(), { x: MARGIN, size: 10, maxWidth: CONTENT_W });
  }

  // ── Terms & Conditions (flows after the bank block; paginates as needed) ──
  space(ctx, 8);
  drawSectionTitle(ctx, "Terms & Conditions");
  drawText(ctx, "FITOVERSE PRIVATE LIMITED     CIN: U92490TZ2022PTC038004     |     GSTIN: 33AAECF8905G1ZQ", { x: MARGIN, size: 9.5, maxWidth: CONTENT_W, color: COL.muted });
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

  // Keep the signatures + Project Contact Points together so the contact
  // line never orphans onto a near-empty page.
  ensureSpace(ctx, 160);
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

  // ── The Fitoverse Advantage — flows right after the signatures/contacts to
  //    fill the page rather than forcing a near-empty gap before it. Its own
  //    title-orphan guard (below) moves it to a fresh page only if it won't fit. ──
  space(ctx, 14);
  drawAdvantagePage(ctx);

  // ── Final page: "Our Portfolio" (real photo + portfolio link) and
  //    "Connect With Us", combined on ONE page. The portfolio photo only
  //    shows for sports that have one; Connect always renders below it. ──
  drawFooter(ctx);
  newPage(ctx);
  // "Our Portfolio" photo section removed (user request) — the per-project
  // portfolio link now lives in the Connect With Us panel below.
  drawConnectPage(ctx, data.driveLink ?? null);

  drawFooter(ctx);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
