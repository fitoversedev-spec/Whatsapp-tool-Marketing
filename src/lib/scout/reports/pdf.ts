import "server-only";

/**
 * HTML → PDF, with headless Chromium. Server-side, never browser print.
 *
 * ## The decision, and why
 *
 * Full Chromium does not fit in a standard Vercel serverless function. Three
 * options were on the table (Phase 6 brief):
 *
 * | Option | Verdict |
 * |---|---|
 * | **`@sparticuz/chromium` + `puppeteer-core`** | **Chosen.** ~66 MB of brotli-compressed binaries in `node_modules`, decompressed into `/tmp` on first use. Comfortably inside Vercel's 250 MB uncompressed function budget once `serverExternalPackages` keeps Next from trying to bundle it. No extra infrastructure, no second deployment target, no cross-service auth. |
 * | A long-running function or container | Rejected for now. It solves a problem this build does not have — a report is one page render, not a stream — and it adds a deployment surface the client has no operator for. |
 * | A separate PDF service | Rejected for the same reason, plus it would mean shipping the report HTML across a network boundary and authenticating it. Worth revisiting only if generation volume makes cold starts the dominant cost. |
 *
 * **Cold start.** The first invocation decompresses the Chromium tarball into
 * `/tmp` (~1–3 s on Lambda-class hardware), then launches it (~0.5–1 s), then
 * renders. Budget **5–8 s cold, 1.5–3 s warm** for a typical report. That is
 * exactly why generation is a background job with a "Report ready" card rather
 * than something a request waits on.
 *
 * **Cost.** No per-document licence or API fee — the only cost is compute. At
 * 1,024 MB and ~6 s a cold generation, one report is ~6 GB-s; Vercel's included
 * monthly allowance covers thousands of them. The real constraint is memory:
 * Chromium needs ≥ 1,024 MB or it is killed mid-render, which is configured on
 * the route, not here.
 *
 * ## Local development
 *
 * `@sparticuz/chromium` ships a **Linux x64** binary and cannot launch on
 * Windows or macOS. Locally the engine probes for a Chromium already on the
 * machine — Playwright's cache first (this repo already installs it for E2E),
 * then Chrome, then Edge. `PDF_CHROMIUM_PATH` overrides everything.
 *
 * ## When there is no Chromium at all
 *
 * `renderPdf` throws `PdfEngineUnavailableError` with a message naming what to
 * install. The caller records the report as `failed` with that message on the
 * row. It never returns an empty or partial file: a zero-byte PDF that WhatsApp
 * accepts and no reader can open is worse than a visible failure.
 */

import { accessSync, constants, readdirSync } from "node:fs";
import { join } from "node:path";

import { REPORT_PAGE } from "./css";

export class PdfEngineUnavailableError extends Error {
  readonly code = "PDF_ENGINE_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "PdfEngineUnavailableError";
  }
}

export interface PdfResult {
  readonly bytes: Buffer;
  readonly engine: string;
  readonly pageCount: number | null;
  readonly durationMs: number;
}

export interface PdfOptions {
  /** Printed at the foot of every page, already escaped for HTML. */
  readonly footerText: string;
  /** Printed at the head of every page after the first. */
  readonly headerText: string;
  /** Milliseconds to allow for fonts and the map image. */
  readonly timeoutMs?: number;
}

/* --------------------------------------------------- executable discovery */

function exists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Playwright's browser cache, newest build first.
 *
 * `chrome-headless-shell` is preferred over the full `chrome` build, and not
 * only because it is smaller and starts faster: on a locked-down Windows
 * machine the full build can fail to spawn outright (`spawn UNKNOWN`) while the
 * headless shell runs, which is exactly what happened on the machine this was
 * developed on. The shell is also the correct binary for the job — this
 * pipeline never needs a window, an extension or a GPU process.
 */
function playwrightChromium(): string | null {
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
      : process.platform === "darwin"
        ? join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright")
        : join(process.env.HOME ?? "", ".cache", "ms-playwright"));

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }

  const shellPaths =
    process.platform === "win32"
      ? ["chrome-headless-shell-win64/chrome-headless-shell.exe"]
      : process.platform === "darwin"
        ? [
            "chrome-headless-shell-mac-arm64/chrome-headless-shell",
            "chrome-headless-shell-mac-x64/chrome-headless-shell",
          ]
        : ["chrome-headless-shell-linux64/chrome-headless-shell"];

  const fullPaths =
    process.platform === "win32"
      ? ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"]
      : process.platform === "darwin"
        ? ["chrome-mac/Chromium.app/Contents/MacOS/Chromium"]
        : ["chrome-linux/chrome"];

  const newestFirst = (prefix: string) =>
    entries.filter((e) => e.startsWith(prefix)).sort().reverse();

  for (const entry of newestFirst("chromium_headless_shell-")) {
    for (const suffix of shellPaths) {
      const candidate = join(root, entry, ...suffix.split("/"));
      if (exists(candidate)) return candidate;
    }
  }
  for (const entry of newestFirst("chromium-")) {
    for (const suffix of fullPaths) {
      const candidate = join(root, entry, ...suffix.split("/"));
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * `chrome-headless-shell` is always headless and rejects `--headless=new`.
 * Puppeteer sends that flag for `headless: true`, so the shell needs
 * `headless: "shell"` instead — a mismatch here is a launch that hangs rather
 * than one that errors, which is far worse to diagnose.
 */
function headlessModeFor(executablePath: string): boolean | "shell" {
  return /chrome-headless-shell/i.test(executablePath) ? "shell" : true;
}

const LOCAL_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ],
};

/** True on Vercel or any Lambda-shaped runtime, where the packaged build wins. */
export function isServerlessRuntime(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.VERCEL);
}

export interface ResolvedEngine {
  readonly name: string;
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly headless: boolean | "shell";
}

export async function resolveEngine(): Promise<ResolvedEngine> {
  const override = process.env.PDF_CHROMIUM_PATH?.trim();
  if (override) {
    if (!exists(override)) {
      throw new PdfEngineUnavailableError(
        `PDF_CHROMIUM_PATH points at ${override}, which is not an executable file.`,
      );
    }
    return {
      name: "chromium/override",
      executablePath: override,
      args: [],
      headless: headlessModeFor(override),
    };
  }

  if (isServerlessRuntime()) {
    try {
      const mod = (await import("@sparticuz/chromium")) as unknown as {
        default: {
          args: string[];
          executablePath: (input?: string) => Promise<string>;
          headless: boolean;
        };
      };
      const chromium = mod.default;
      return {
        name: "chromium/sparticuz",
        executablePath: await chromium.executablePath(),
        args: chromium.args,
        headless: true,
      };
    } catch (error) {
      throw new PdfEngineUnavailableError(
        `@sparticuz/chromium could not be loaded in this runtime: ${(error as Error).message}. ` +
          `Check that it is listed in serverExternalPackages and that the function has at least 1024 MB.`,
      );
    }
  }

  const fromPlaywright = playwrightChromium();
  if (fromPlaywright) {
    return {
      name: "chromium/playwright",
      executablePath: fromPlaywright,
      args: [],
      headless: headlessModeFor(fromPlaywright),
    };
  }

  for (const candidate of LOCAL_CANDIDATES[process.platform] ?? []) {
    if (exists(candidate)) {
      return { name: "chromium/local", executablePath: candidate, args: [], headless: true };
    }
  }

  throw new PdfEngineUnavailableError(
    "No Chromium is available to render the PDF. On a developer machine, either install Google " +
      "Chrome, run `npx playwright install chromium`, or set PDF_CHROMIUM_PATH to a Chromium " +
      "executable. On Vercel this should never happen — @sparticuz/chromium is a dependency.",
  );
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
