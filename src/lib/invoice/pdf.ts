// Invoice PDF renderer — a clean, single-purpose branded invoice built on
// pdf-lib (same runtime-safe choice as the quotation renderer; see
// quotation/pdf.ts for the OneDrive/react-pdf backstory). Deliberately simple:
// header + Bill-To + line-item table + totals + bank/terms. Not the full
// quotation showcase document.

import { PDFDocument, StandardFonts, rgb, PageSizes, PDFFont, PDFPage } from "pdf-lib";
import type { QuoteLineItem } from "@/lib/quotation/calculator";
import fs from "fs";
import path from "path";

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

// Fitoverse contact footer line (brand reference).
const COMPANY = { name: "Fitoverse", phone: "+91 63815 02055", email: "fitoverseofficial3.0@gmail.com" };

function inr(n: number): string {
  return "Rs. " + Math.round(n).toLocaleString("en-IN");
}
function d(dt: Date): string {
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// pdf-lib's StandardFonts use WinAnsi encoding, whose encoder (used by BOTH
// drawText and widthOfTextAtSize) throws on any code point outside 0x00–0xFF —
// non-Latin scripts (Tamil/Hindi/Kannada), emoji, and even the smart quotes /
// en-dashes phones and Word insert automatically. Every user-supplied string
// (invoice name = customer name, line-item labels, address, notes) must pass
// through this before being drawn or measured, or the whole render throws and
// the invoice can never produce a PDF. Mirrors quotation/pdf.ts's sanitize().
const SAFE_MAP: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "•": "-", "₹": "Rs." };
function sanitize(s: string): string {
  if (!s) return "";
  let out = s;
  for (const [f, t] of Object.entries(SAFE_MAP)) out = out.split(f).join(t);
  return out.replace(/[^\x00-\xFF]/g, "");
}

export type InvoicePdfInput = {
  number: string;
  customerName: string;
  contactPhone?: string | null;
  billingAddress?: string | null;
  sportLabel: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
  amountPaid: number;
  invoiceDate: Date;
  dueDate: Date;
  notes?: string | null;
};

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = LOGO_BYTES ? await doc.embedPng(LOGO_BYTES).catch(() => null) : null;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const text = (p: PDFPage, s: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    p.drawText(sanitize(s), { x, y: yy, size, font: f, color });
  // Sanitized width measure — pairs with text() so right-aligned x-positions use
  // the same (safe) string that actually gets drawn.
  const sw = (f: PDFFont, s: string, size: number) => f.widthOfTextAtSize(sanitize(s), size);

  // ── Header: logo + INVOICE title + meta ──
  if (logo) {
    const lw = 120;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: MARGIN, y: y - lh + 6, width: lw, height: lh });
  } else {
    text(page, COMPANY.name, MARGIN, y - 14, 20, bold, GREEN);
  }
  text(page, "INVOICE", PAGE_W - MARGIN - bold.widthOfTextAtSize("INVOICE", 26), y - 4, 26, bold, GREEN_DEEP);
  y -= 46;
  const metaX = PAGE_W - MARGIN - 200;
  const metaRow = (label: string, val: string, yy: number) => {
    text(page, label, metaX, yy, 9, font, MUTED);
    text(page, val, PAGE_W - MARGIN - sw(bold, val, 9), yy, 9, bold, INK);
  };
  metaRow("Invoice No.", input.number, y);
  metaRow("Invoice Date", d(input.invoiceDate), y - 14);
  metaRow("Due Date", d(input.dueDate), y - 28);

  // Brand rule
  page.drawRectangle({ x: MARGIN, y: y - 40, width: CONTENT_W, height: 2.5, color: GREEN });

  // ── Bill To ──
  let by = y - 58;
  text(page, "BILL TO", MARGIN, by, 9, bold, MUTED);
  by -= 15;
  text(page, input.customerName, MARGIN, by, 13, bold, INK);
  by -= 14;
  text(page, `Sport: ${input.sportLabel}`, MARGIN, by, 9, font, MUTED);
  if (input.contactPhone) {
    by -= 12;
    text(page, `Phone: ${input.contactPhone}`, MARGIN, by, 9, font, MUTED);
  }
  if (input.billingAddress) {
    for (const line of wrap(input.billingAddress, 60).slice(0, 3)) {
      by -= 12;
      text(page, line, MARGIN, by, 9, font, MUTED);
    }
  }

  // ── Line-item table ──
  const items = input.lineItems.filter((li) => li.included);
  const cols = [
    { key: "sn", label: "#", w: 26, align: "left" as const },
    { key: "name", label: "Particulars", w: CONTENT_W - 26 - 70 - 70 - 46 - 80, align: "left" as const },
    { key: "qty", label: "Qty", w: 70, align: "right" as const },
    { key: "rate", label: "Rate", w: 70, align: "right" as const },
    { key: "gst", label: "GST%", w: 46, align: "right" as const },
    { key: "amt", label: "Amount", w: 80, align: "right" as const },
  ];
  let ty = by - 24;

  const drawTableHead = () => {
    page.drawRectangle({ x: MARGIN, y: ty - 4, width: CONTENT_W, height: 20, color: GREEN });
    let cx = MARGIN + 6;
    for (const c of cols) {
      const tx = c.align === "right" ? cx + c.w - 6 - bold.widthOfTextAtSize(c.label, 9) : cx;
      text(page, c.label, tx, ty + 2, 9, bold, HEAD_TXT);
      cx += c.w;
    }
    ty -= 20;
  };
  drawTableHead();

  items.forEach((li, i) => {
    const nameLines = wrap(li.name, 52);
    const rowH = Math.max(18, 6 + nameLines.length * 11);
    if (ty - rowH < MARGIN + 140) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      ty = PAGE_H - MARGIN - 10;
      drawTableHead();
    }
    if (i % 2 === 1) page.drawRectangle({ x: MARGIN, y: ty - rowH + 12, width: CONTENT_W, height: rowH, color: ROW_ALT });
    let cx = MARGIN + 6;
    const cell = (val: string, col: (typeof cols)[number], f = font, color = INK) => {
      const tx = col.align === "right" ? cx + col.w - 6 - sw(f, val, 9) : cx;
      text(page, val, tx, ty + 2, 9, f, color);
      cx += col.w;
    };
    cell(String(i + 1), cols[0]);
    // name column (may wrap)
    nameLines.forEach((ln, k) => text(page, ln, cx, ty + 2 - k * 11, 9, font, INK));
    cx += cols[1].w;
    cell(`${Math.round(li.areaSqFt).toLocaleString("en-IN")}${li.unit ? " " + li.unit : ""}`, cols[2]);
    cell(inr(li.ratePerSqFt), cols[3]);
    cell(`${li.gstPercent}%`, cols[4]);
    cell(inr(li.total), cols[5]);
    ty -= rowH;
    page.drawLine({ start: { x: MARGIN, y: ty + 10 }, end: { x: PAGE_W - MARGIN, y: ty + 10 }, thickness: 0.5, color: BORDER });
  });

  // ── Totals ──
  const balance = Math.max(0, input.grandTotal - input.amountPaid);
  const tX = PAGE_W - MARGIN - 220;
  let tyT = ty - 10;
  const totalRow = (label: string, val: string, opts?: { bold?: boolean; band?: boolean; color?: typeof INK }) => {
    if (opts?.band) page.drawRectangle({ x: tX, y: tyT - 5, width: 220, height: 22, color: GREEN });
    const f = opts?.bold ? bold : font;
    const color = opts?.band ? HEAD_TXT : opts?.color ?? INK;
    text(page, label, tX + 6, tyT + 2, 10, f, color);
    text(page, val, PAGE_W - MARGIN - 6 - sw(f, val, 10), tyT + 2, 10, f, color);
    tyT -= opts?.band ? 26 : 18;
  };
  totalRow("Subtotal", inr(input.subtotal));
  totalRow("GST", inr(input.gstAmount));
  totalRow("Grand Total", inr(input.grandTotal), { bold: true, band: true });
  if (input.amountPaid > 0) {
    totalRow("Amount Paid", inr(input.amountPaid), { color: GREEN_DEEP });
    totalRow("Balance Due", inr(balance), { bold: true, color: balance > 0 ? rgb(0.784, 0.067, 0.141) : GREEN_DEEP });
  }

  // ── Bank details + notes + footer (on the current/last page) ──
  let fy = Math.min(tyT, ty) - 24;
  if (fy < MARGIN + 90) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    fy = PAGE_H - MARGIN - 20;
  }
  text(page, "Payment details", MARGIN, fy, 9, bold, INK);
  fy -= 13;
  for (const line of ["Account name: Fitoverse", "Please use the invoice number as the payment reference."]) {
    text(page, line, MARGIN, fy, 8.5, font, MUTED);
    fy -= 11;
  }
  if (input.notes) {
    fy -= 6;
    text(page, "Notes", MARGIN, fy, 9, bold, INK);
    fy -= 13;
    for (const line of wrap(input.notes, 95).slice(0, 5)) {
      text(page, line, MARGIN, fy, 8.5, font, MUTED);
      fy -= 11;
    }
  }

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 4 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 4 }, thickness: 0.5, color: BORDER });
    text(p, `${COMPANY.name}  ·  ${COMPANY.phone}  ·  ${COMPANY.email}`, MARGIN, MARGIN - 8, 8, font, MUTED);
    const pn = `Page ${i + 1} of ${pages.length}`;
    text(p, pn, PAGE_W - MARGIN - font.widthOfTextAtSize(pn, 8), MARGIN - 8, 8, font, MUTED);
  });

  return doc.save();
}

// Naive width-based word wrap (character estimate) — fine for the fixed fonts
// and column widths used here.
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
