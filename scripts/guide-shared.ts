/**
 * Shared auth + browser setup for guide screenshot and recording scripts.
 * Both scripts connect to a running dev server at http://localhost:3000.
 */
import { resolveEngine } from "../src/lib/chromium-engine";

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

export async function authenticate(page: import("puppeteer-core").Page): Promise<void> {
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

export async function setupPage(page: import("puppeteer-core").Page): Promise<void> {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await authenticate(page);
  // Force light theme
  await page.evaluate(() => {
    try { localStorage.setItem("ccd_theme", "light"); } catch {}
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
