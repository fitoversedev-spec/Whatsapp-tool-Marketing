import { accessSync, constants, readdirSync } from "node:fs";
import { join } from "node:path";

export class PdfEngineUnavailableError extends Error {
  readonly code = "PDF_ENGINE_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "PdfEngineUnavailableError";
  }
}

function exists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

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

export function headlessModeFor(executablePath: string): boolean | "shell" {
  return /chrome-headless-shell/i.test(executablePath) ? "shell" : true;
}

export const LOCAL_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
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
