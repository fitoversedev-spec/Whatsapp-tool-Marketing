// One place decides what a quotation's PDF contains and where the saved copy
// lives, so the preview, the WhatsApp / WhatsApp Web send and the customer's
// /q/[id] link all show exactly the same document.
//
// A saved PDF is named after a short fingerprint ("key") of everything that is
// drawn on it. If the quote is edited the fingerprint changes, the saved copy no
// longer matches and the next request rebuilds it — nothing has to remember to
// clear pdfUrl, and a customer's link always opens the newest version.
import { createHash } from "node:crypto";
import type { Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { uploadToBlob } from "@/lib/media";
import type { QuotationPdfData } from "./pdf";
import type { QuoteLineItem } from "./calculator";

// Bump when the PDF layout / renderer changes, so every saved PDF is rebuilt.
export const RENDER_VERSION = 1;

/** A quotation row; `deal` is optional — when absent its siteCity is looked up. */
export type QuotationRow = Quotation & { deal?: { siteCity: string | null } | null };

/** Everything the PDF renderer draws, from a quotation row (+ deal city, drive link). */
export async function buildQuotationPdfInputs(q: QuotationRow): Promise<QuotationPdfData> {
  const [driveLink, siteCity] = await Promise.all([
    prisma.setting.findUnique({ where: { key: `project_drive_link_${q.sport}` } }).then((s) => s?.value ?? null),
    q.deal !== undefined
      ? Promise.resolve(q.deal?.siteCity ?? null)
      : q.dealId
        ? prisma.deal.findUnique({ where: { id: q.dealId }, select: { siteCity: true } }).then((d) => d?.siteCity ?? null)
        : Promise.resolve(null),
  ]);
  const lineItems = JSON.parse(q.lineItems) as QuoteLineItem[];
  return {
    number: q.number,
    customerName: q.customerName,
    siteCity,
    sport: q.sport,
    lengthFt: q.lengthFt,
    widthFt: q.widthFt,
    lineItems,
    subtotal: Number(q.subtotal),
    gstAmount: Number(q.gstAmount),
    grandTotal: Number(q.grandTotal),
    notes: q.notes,
    quoteDate: q.quoteDate,
    validityDays: q.validityDays,
    driveLink,
    salespersonPhone: q.salespersonPhone ?? null,
    sections: q.sections ? (() => { try { return JSON.parse(q.sections); } catch { return null; } })() : null,
  };
}

/** First 12 hex chars of a fingerprint over every rendered input + RENDER_VERSION. */
export function pdfKey(inputs: QuotationPdfData): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: RENDER_VERSION, inputs }))
    .digest("hex")
    .slice(0, 12);
}

/** Does this saved-PDF URL belong to `key`? (uploadToBlob keeps the key in the file name.) */
export function urlHasKey(url: string | null | undefined, key: string): boolean {
  return !!url && url.includes(`-${key}-`);
}

/** Customer-facing file name, e.g. FIT-QT-2026-086-Acme-Sports.pdf */
export function quotationFileName(q: { number: string; customerName: string | null }): string {
  return `${q.number}-${(q.customerName ?? "quote").replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`;
}

/** Render the PDF bytes only — no upload (the preview's fast path). */
export async function renderQuotationPdfBytes(inputs: QuotationPdfData): Promise<Buffer> {
  // Loaded on demand: the renderer is large and /q/[id] usually just redirects.
  const { renderQuotationPdf } = await import("./pdf");
  return Buffer.from(await renderQuotationPdf(inputs));
}

/** Save rendered bytes to Blob and point the quotation at them. Returns the URL. */
export async function saveQuotationPdf(
  q: { id: string; number: string; customerName: string | null },
  key: string,
  bytes: Buffer,
): Promise<string> {
  // The key leads the name so it survives uploadToBlob's 40-character slug.
  const uploaded = await uploadToBlob({
    bytes,
    fileName: `${key}-${quotationFileName(q)}`,
    mimeType: "application/pdf",
    folder: "quotations",
  });
  await prisma.quotation.updateMany({ where: { id: q.id }, data: { pdfUrl: uploaded.url } });
  return uploaded.url;
}

/**
 * The saved PDF for this quotation as it is right now. Reuses pdfUrl when it
 * matches the current key; otherwise renders, uploads and saves a fresh copy.
 * Throws if rendering or uploading fails.
 */
export async function ensureQuotationPdf(q: QuotationRow): Promise<{ url: string; key: string }> {
  const inputs = await buildQuotationPdfInputs(q);
  const key = pdfKey(inputs);
  if (q.pdfUrl && urlHasKey(q.pdfUrl, key)) return { url: q.pdfUrl, key };
  const url = await saveQuotationPdf(q, key, await renderQuotationPdfBytes(inputs));
  return { url, key };
}
