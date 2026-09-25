/**
 * Shared auth + browser setup for guide screenshot and recording scripts.
 * Both scripts connect to a running dev server at http://localhost:3000.
 */
import type { Page } from "puppeteer-core";
import { resolveEngine } from "../src/lib/chromium-engine";
import type { ScreenshotSetupAction } from "../src/lib/help/types";

const BASE_URL = process.env.GUIDE_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.GUIDE_EMAIL ?? "admintest@gmail.com";
const PASSWORD = process.env.GUIDE_PASSWORD ?? "Fito@123";

export { BASE_URL };

export async function launchBrowser() {
  const engine = await resolveEngine();
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath: engine.executablePath,
    args: [...engine.args, "--no-sandbox", "--disable-dev-shm-usage"],
    headless: engine.headless,
  });
  return browser;
}

export async function authenticate(page: Page): Promise<void> {
  const res = await page.evaluate(
    async (url: string, email: string, password: string) => {
      const r = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return { status: r.status, body: await r.json() };
    },
    BASE_URL,
    EMAIL,
    PASSWORD,
  );

  if (res.status !== 200) {
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  console.log(`Authenticated as ${EMAIL}`);
}

export async function setupPage(page: Page): Promise<void> {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 120000 });
  await authenticate(page);
  // Force light theme
  await page.evaluate(() => {
    try { localStorage.setItem("ccd_theme", "light"); } catch {}
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the page has stopped fetching and no "Loading…" placeholder is
 * left, so screenshots never capture a half-loaded page. Best effort: pages
 * that poll never go fully network-idle, so every wait has a ceiling.
 */
export async function waitForPageReady(page: Page, timeout = 15000, idleTimeout = 8000): Promise<void> {
  await page.waitForNetworkIdle({ idleTime: 700, timeout: idleTimeout }).catch(() => {});
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll("body *")].some(
          (el) => el.children.length === 0 && /^loading(\.\.\.|…)?$/i.test((el.textContent ?? "").trim()),
        ),
      { timeout },
    )
    .catch(() => {});
  await page
    .evaluate(async () => {
      const pending = [...document.images].filter((img) => !img.complete);
      if (pending.length === 0) return;
      await Promise.race([
        Promise.all(
          pending.map(
            (img) =>
              new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve());
                img.addEventListener("error", () => resolve());
              }),
          ),
        ),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    })
    .catch(() => {});
  await sleep(400);
}

/** Returns a description of what is wrong with the current page, or null when it looks healthy. */
export async function pageProblem(page: Page): Promise<string | null> {
  return page
    .evaluate(() => {
      const text = document.body?.innerText ?? "";
      if (/Server Error|Application error: a (?:client|server)-side exception|Unhandled Runtime Error|Internal Server Error/i.test(text)) {
        return "an error page was rendered";
      }
      if (/This page could not be found/i.test(text)) return "the page returned 404";
      if (text.trim().length < 20) return "the page is blank";
      const stillLoading = [...document.querySelectorAll("body *")].some(
        (el) =>
          el.children.length === 0 &&
          /^loading(\.\.\.|…)?$/i.test((el.textContent ?? "").trim()) &&
          (el as HTMLElement).offsetParent !== null,
      );
      if (stillLoading) return "the page is still loading";
      return null;
    })
    .catch((err: Error) => `page could not be inspected (${err.message})`);
}

function loginRedirect(page: Page): boolean {
  return new URL(page.url()).pathname.startsWith("/login");
}

/**
 * Navigate and only return once the page is loaded AND healthy. The dev server
 * regularly throws transient errors (e.g. "Cannot read properties of null
 * (reading 'useContext')") on the first request to a route while it compiles,
 * so an unhealthy page is retried instead of being screenshotted.
 */
export async function visitPage(page: Page, path: string, attempts = 4): Promise<void> {
  let lastProblem = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await waitForPageReady(page);
      if (loginRedirect(page) && !path.startsWith("/login")) {
        lastProblem = "redirected to /login (session lost)";
      } else {
        const problem = await pageProblem(page);
        if (!problem) return;
        lastProblem = problem;
      }
    } catch (err) {
      lastProblem = (err as Error).message;
    }
    console.warn(`  Attempt ${attempt}/${attempts} at ${path} failed: ${lastProblem}`);
    await sleep(2500 * attempt);
  }
  throw new Error(`Could not load ${path}: ${lastProblem}`);
}

async function clickSelector(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { visible: true, timeout: 20000 });
  try {
    await page.click(selector);
  } catch {
    // Covered by another element (sticky header, toast) — fall back to a DOM click.
    await page.$eval(selector, (el) => (el as HTMLElement).click());
  }
}

export async function runSetupActions(page: Page, actions: ScreenshotSetupAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "navigate":
        await visitPage(page, action.url);
        break;
      case "click":
        await clickSelector(page, action.selector);
        await sleep(600);
        // A click can open a route the dev server has not compiled yet (20–40 s), so allow a long network-idle wait.
        await waitForPageReady(page, 20000, 45000);
        break;
      case "hover":
        await page.waitForSelector(action.selector, { visible: true, timeout: 20000 });
        await page.hover(action.selector);
        await sleep(600);
        break;
      case "type":
        await page.waitForSelector(action.selector, { visible: true, timeout: 20000 });
        await page.type(action.selector, action.text, { delay: 40 });
        await sleep(400);
        break;
      case "scroll":
        await page.evaluate(
          (sel: string | undefined, dir: string, amt: number) => {
            const el = sel ? document.querySelector(sel) : document.scrollingElement;
            el?.scrollBy({ top: dir === "down" ? amt : -amt });
          },
          action.selector,
          action.direction,
          action.amount ?? 300,
        );
        await sleep(500);
        break;
      case "wait":
        await sleep(action.duration);
        break;
    }
  }
}
