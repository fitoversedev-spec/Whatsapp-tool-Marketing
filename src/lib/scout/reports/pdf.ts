import "server-only";

import { REPORT_PAGE } from "./css";

export {
  PdfEngineUnavailableError,
  resolveEngine,
  isServerlessRuntime,
  type ResolvedEngine,
} from "@/lib/chromium-engine";

import { resolveEngine } from "@/lib/chromium-engine";

export interface PdfResult {
  readonly bytes: Buffer;
  readonly engine: string;
  readonly pageCount: number | null;
  readonly durationMs: number;
}

export interface PdfOptions {
  readonly footerText: string;
  readonly headerText: string;
  readonly timeoutMs?: number;
}

/* ---------------------------------------------------------------- render */

/** Chromium's header/footer templates ignore the page stylesheet entirely. */
function template(inner: string): string {
  return (
    `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:6.5pt;color:#6e6e73;` +
    `padding:0 12mm;display:flex;justify-content:space-between;align-items:center;gap:8px;">${inner}</div>`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function headerTemplate(text: string): string {
  return template(
    `<span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(text)}</span>`,
  );
}

/**
 * The client's legal footer, on every page, with the page number.
 *
 * `.pageNumber` and `.totalPages` are Chromium's own substitution classes and
 * are the only way to get a page count into the document — CSS counters in
 * `@page` margin boxes are not implemented.
 */
export function footerTemplate(text: string): string {
  return template(
    `<span style="flex:1;overflow:hidden">${escapeHtml(text)}</span>` +
      `<span style="white-space:nowrap"><span class="pageNumber"></span> / <span class="totalPages"></span></span>`,
  );
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function renderPdf(html: string, options: PdfOptions): Promise<PdfResult> {
  const started = Date.now();
  const engine = await resolveEngine();

  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath: engine.executablePath,
    args: [...engine.args, "--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    headless: engine.headless,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: "load",
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    // `load` fires before webfonts have been applied, and a PDF typeset in the
    // fallback face because the fonts had not landed is a different document —
    // different line breaks, different page breaks. `document.fonts.ready` is
    // the precise wait; a blanket network-idle wait would also sit through
    // whatever else the page happened to be doing. The catch matters: with no
    // egress the fonts never resolve, and a report in the fallback face is far
    // better than no report.
    await page
      .evaluate(() => document.fonts.ready.then(() => undefined))
      .catch(() => undefined);
    await page.emulateMediaType("print");

    const bytes = Buffer.from(
      await page.pdf({
        width: `${REPORT_PAGE.widthMm}mm`,
        height: `${REPORT_PAGE.heightMm}mm`,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: headerTemplate(options.headerText),
        footerTemplate: footerTemplate(options.footerText),
        margin: {
          top: `${REPORT_PAGE.marginTopMm}mm`,
          bottom: `${REPORT_PAGE.marginBottomMm}mm`,
          left: `${REPORT_PAGE.marginSideMm}mm`,
          right: `${REPORT_PAGE.marginSideMm}mm`,
        },
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    );

    return {
      bytes,
      engine: engine.name,
      pageCount: countPdfPages(bytes),
      durationMs: Date.now() - started,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Page count, read out of the PDF itself.
 *
 * Counting `/Type /Page` objects is crude but exact for a Chromium-produced
 * file, which writes one uncompressed page object per page. `null` rather than
 * a guess if the pattern is not found — a wrong page count printed next to a
 * report is the kind of small lie that costs trust in the big numbers.
 */
export function countPdfPages(bytes: Buffer): number | null {
  const text = bytes.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches && matches.length > 0 ? matches.length : null;
}
