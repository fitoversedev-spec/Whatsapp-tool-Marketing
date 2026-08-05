// Feature 2 (AI analytics reports) — PDF renderer. Clones the structure and
// brand styling of src/lib/invoice/pdf.ts (A4, green #159341 header, tables
// with a coloured head row + alternating stripes, per-page footer + page
// numbers) so a report exports as a clean branded document. The data blocks
// come back from the tool loop in many different shapes (arrays of rows, nested
// objects), so a small generic renderer flattens each block into headings +
// tables + key/value lists. ALL text is routed through sanitize() exactly like
// the invoice renderer — pdf-lib's WinAnsi fonts throw on emoji / Tamil / smart
// quotes / the rupee sign, and a report question or note can contain any of them.
import { PDFDocument, StandardFonts, rgb, PageSizes, PDFFont, PDFPage } from "pdf-lib";
import fs from "fs";
import path from "path";
import type { AiReportDataBlock } from "./report";

let LOGO_BYTES: Buffer | null = null;
try {
  LOGO_BYTES = fs.readFileSync(path.join(process.cwd(), "public", "quotation-assets", "image1.png"));
} catch {
  LOGO_BYTES = null;
}

const PAGE_W = PageSizes.A4[0];
const PAGE_H = PageSizes.A4[1];
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const GREEN = rgb(0.082, 0.576, 0.255); // #159341
const GREEN_DEEP = rgb(0.043, 0.42, 0.184);
const INK = rgb(0.114, 0.157, 0.192);
const MUTED = rgb(0.451, 0.502, 0.549);
const BORDER = rgb(0.851, 0.871, 0.894);
const ROW_ALT = rgb(0.972, 0.98, 0.988);
const HEAD_TXT = rgb(1, 1, 1);

const COMPANY = { name: "Fitoverse", phone: "+91 63815 02055", email: "fitoverseofficial3.0@gmail.com" };

// Same sanitize as invoice/pdf.ts — map the few substitutable glyphs (rupee →
// "Rs.", smart quotes/dashes → ASCII) then drop any remaining non-Latin-1 code
// point (emoji, Tamil/Hindi/Kannada) so drawText/widthOfTextAtSize never throw.
const SAFE_MAP: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "•": "-", "₹": "Rs." };
function sanitize(s: string): string {
  if (!s) return "";
  let out = s;
  for (const [f, t] of Object.entries(SAFE_MAP)) out = out.split(f).join(t);
  return out.replace(/[^\x00-\xFF]/g, "");
}

function d(dt: Date): string {
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Value formatting ──────────────────────────────────────────────────────
function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "-";
    if (Number.isInteger(v)) return v.toLocaleString("en-IN");
    return (Math.round(v * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + "..." : s;
  }
  return String(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// ── Renderables: a flat list the drawer paints top to bottom ──────────────
type Renderable =
  | { kind: "heading"; text: string; level: 1 | 2 }
  | { kind: "note"; text: string }
  | { kind: "kv"; pairs: Array<[string, string]> }
  | { kind: "table"; columns: string[]; rows: string[][] };

const MAX_TABLE_ROWS = 40;
const MAX_RECORD_ROWS = 20;
const WIDE_COL_LIMIT = 6; // above this, render array rows as key/value records

function keyUnion(items: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const it of items.slice(0, 10)) {
    for (const k of Object.keys(it)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

// Turn one arbitrary value into renderables (one level of nesting for the
// object → array-of-rows shapes the analytics functions return).
function valueToRenderables(value: unknown, depth = 0): Renderable[] {
  const out: Renderable[] = [];

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ kind: "note", text: "No rows returned (n = 0)." });
      return out;
    }
    if (isPlainObject(value[0])) {
      const items = value as Record<string, unknown>[];
      const cols = keyUnion(items);
      if (cols.length <= WIDE_COL_LIMIT) {
        const rows = items.slice(0, MAX_TABLE_ROWS).map((it) => cols.map((c) => fmtVal(it[c])));
        out.push({ kind: "table", columns: cols, rows });
        if (items.length > MAX_TABLE_ROWS) out.push({ kind: "note", text: `(+${items.length - MAX_TABLE_ROWS} more rows)` });
      } else {
        // Too wide for a portrait table — render each row as a key/value record.
        const shown = items.slice(0, MAX_RECORD_ROWS);
        shown.forEach((it, i) => {
          out.push({ kind: "heading", text: `Row ${i + 1}`, level: 2 });
          out.push({ kind: "kv", pairs: cols.map((c): [string, string] => [c, fmtVal(it[c])]) });
        });
        if (items.length > MAX_RECORD_ROWS) out.push({ kind: "note", text: `(+${items.length - MAX_RECORD_ROWS} more rows)` });
      }
      return out;
    }
    // Array of primitives.
    out.push({ kind: "table", columns: ["value"], rows: (value as unknown[]).slice(0, MAX_TABLE_ROWS).map((x) => [fmtVal(x)]) });
    return out;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const scalarPairs: Array<[string, string]> = [];
    const nested: Array<[string, unknown]> = [];
    for (const [k, v] of entries) {
      if (Array.isArray(v) && v.length && isPlainObject(v[0]) && depth === 0) nested.push([k, v]);
      else scalarPairs.push([k, fmtVal(v)]);
    }
    if (scalarPairs.length) out.push({ kind: "kv", pairs: scalarPairs });
    for (const [k, v] of nested) {
      out.push({ kind: "heading", text: k, level: 2 });
      out.push(...valueToRenderables(v, depth + 1));
    }
    return out;
  }

  out.push({ kind: "note", text: fmtVal(value) });
  return out;
}

export type AiReportPdfInput = {
  question: string;
  narrative: string;
  dataBlocks: AiReportDataBlock[];
};

export async function renderAiReportPdf(input: AiReportPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = LOGO_BYTES ? await doc.embedPng(LOGO_BYTES).catch(() => null) : null;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const text = (p: PDFPage, s: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    p.drawText(sanitize(s), { x, y: yy, size, font: f, color });
  const sw = (f: PDFFont, s: string, size: number) => f.widthOfTextAtSize(sanitize(s), size);

  // Add a fresh page and reset the cursor near the top.
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN - 10;
  };
  // Ensure at least `h` vertical space remains above the footer band.
  const ensure = (h: number) => {
    if (y - h < MARGIN + 40) newPage();
  };

  // Truncate a string to fit `maxW` at `size`, appending "..." (ASCII, so it
  // survives sanitize) when clipped.
  const clip = (s: string, f: PDFFont, size: number, maxW: number): string => {
    const safe = sanitize(s);
    if (f.widthOfTextAtSize(safe, size) <= maxW) return safe;
    let lo = 0;
    let hi = safe.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (f.widthOfTextAtSize(safe.slice(0, mid) + "...", size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return safe.slice(0, lo) + "...";
  };

  // ── Renderable drawers (closures over the page/y cursor) ──
  const drawTable = (columns: string[], rows: string[][]) => {
    const n = Math.max(1, columns.length);
    const colW = CONTENT_W / n;
    const drawHead = () => {
      ensure(20);
      page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 18, color: GREEN });
      columns.forEach((c, i) => {
        text(page, clip(c, bold, 8.5, colW - 8), MARGIN + i * colW + 4, y, 8.5, bold, HEAD_TXT);
      });
      y -= 20;
    };
    drawHead();
    rows.forEach((row, ri) => {
      if (y - 15 < MARGIN + 40) {
        newPage();
        drawHead();
      }
      if (ri % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - 3, width: CONTENT_W, height: 14, color: ROW_ALT });
      row.forEach((cell, ci) => {
        text(page, clip(cell, font, 8, colW - 8), MARGIN + ci * colW + 4, y, 8, font, INK);
      });
      y -= 14;
    });
    page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: PAGE_W - MARGIN, y: y + 8 }, thickness: 0.5, color: BORDER });
    y -= 4;
  };

  const drawRenderable = (r: Renderable) => {
    if (r.kind === "heading") {
      ensure(18);
      const size = r.level === 2 ? 9.5 : 11;
      text(page, r.text, MARGIN + (r.level === 2 ? 8 : 0), y, size, bold, r.level === 2 ? INK : GREEN_DEEP);
      y -= r.level === 2 ? 14 : 16;
      return;
    }
    if (r.kind === "note") {
      ensure(13);
      text(page, r.text, MARGIN + 8, y, 8.5, font, MUTED);
      y -= 13;
      return;
    }
    if (r.kind === "kv") {
      const labelW = 150;
      for (const [label, val] of r.pairs) {
        ensure(12);
        text(page, clip(label, font, 8.5, labelW - 6), MARGIN + 8, y, 8.5, font, MUTED);
        text(page, clip(val, font, 8.5, CONTENT_W - labelW - 8), MARGIN + 8 + labelW, y, 8.5, font, INK);
        y -= 12;
      }
      y -= 2;
      return;
    }
    // table
    drawTable(r.columns, r.rows);
  };

  // ── Header ──
  if (logo) {
    const lw = 120;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: MARGIN, y: y - lh + 6, width: lw, height: lh });
  } else {
    text(page, COMPANY.name, MARGIN, y - 14, 20, bold, GREEN);
  }
  text(page, "AI ANALYTICS REPORT", PAGE_W - MARGIN - sw(bold, "AI ANALYTICS REPORT", 16), y - 2, 16, bold, GREEN_DEEP);
  text(page, `Generated ${d(new Date())}`, PAGE_W - MARGIN - sw(font, `Generated ${d(new Date())}`, 9), y - 16, 9, font, MUTED);
  y -= 44;
  page.drawRectangle({ x: MARGIN, y: y, width: CONTENT_W, height: 2.5, color: GREEN });
  y -= 22;

  // ── Question ──
  text(page, "QUESTION", MARGIN, y, 9, bold, MUTED);
  y -= 15;
  for (const line of wrap(input.question || "(no question)", 95)) {
    ensure(14);
    text(page, line, MARGIN, y, 11, bold, INK);
    y -= 14;
  }
  y -= 10;

  // ── Narrative (the model's prose answer) ──
  text(page, "ANSWER", MARGIN, y, 9, bold, MUTED);
  y -= 15;
  const narrative = (input.narrative || "").trim() || "(the model returned no narrative)";
  for (const para of narrative.split(/\n/)) {
    if (para.trim() === "") {
      y -= 6;
      continue;
    }
    for (const line of wrap(para, 100)) {
      ensure(13);
      text(page, line, MARGIN, y, 10, font, INK);
      y -= 13;
    }
  }
  y -= 8;

  // ── Data blocks (the real numbers behind the answer) ──
  if (input.dataBlocks.length) {
    ensure(40);
    page.drawRectangle({ x: MARGIN, y: y, width: CONTENT_W, height: 1.5, color: BORDER });
    y -= 18;
    text(page, "SUPPORTING DATA", MARGIN, y, 9, bold, MUTED);
    y -= 20;
  }

  for (const block of input.dataBlocks) {
    ensure(30);
    text(page, block.title, MARGIN, y, 12, bold, GREEN_DEEP);
    text(page, `(${block.tool})`, MARGIN + sw(bold, block.title, 12) + 8, y, 8, font, MUTED);
    y -= 16;

    for (const r of valueToRenderables(block.rows)) {
      drawRenderable(r);
    }
    y -= 10;
  }

  // ── Footer on every page ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 4 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 4 }, thickness: 0.5, color: BORDER });
    text(p, `${COMPANY.name}  ·  ${COMPANY.phone}  ·  ${COMPANY.email}`, MARGIN, MARGIN - 8, 8, font, MUTED);
    const pn = `Page ${i + 1} of ${pages.length}`;
    text(p, pn, PAGE_W - MARGIN - font.widthOfTextAtSize(pn, 8), MARGIN - 8, 8, font, MUTED);
  });

  return doc.save();
}

// Naive word wrap (character estimate) — same helper the invoice renderer uses.
function wrap(s: string, maxChars: number): string[] {
  const words = s.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [s];
}
