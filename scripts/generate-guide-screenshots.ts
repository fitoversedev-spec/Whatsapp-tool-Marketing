/**
 * Auto-generate annotated screenshots for guide entries.
 * Usage: npx tsx scripts/generate-guide-screenshots.ts [--only=slug1,slug2]
 *
 * Requires dev server running at http://localhost:3000
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { launchBrowser, setupPage, sleep, BASE_URL } from "./guide-shared";

import { ALL_GUIDE_ENTRIES } from "../src/lib/help/registry";
import type { Page } from "puppeteer-core";

const OUTPUT_DIR = join(process.cwd(), "public", "guide");

const PRE_AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password"]);

async function processEntry(page: Page, entry: (typeof ALL_GUIDE_ENTRIES)[number]) {
  try {
    console.log(`\nProcessing: ${entry.slug}`);
    const url = `${BASE_URL}${entry.screenshot.path}`;
    console.log(`  Navigating to ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);

    // Inject annotation overlays for steps with targets
    let annotationCount = 0;
    for (let i = 0; i < entry.steps.length; i++) {
      const step = entry.steps[i];
      if (!step.target) continue;

      const selector = `[data-guide="${step.target}"]`;
      const found = await page.$(selector);
      if (!found) {
        console.warn(`  Warning: data-guide="${step.target}" not found on page`);
        continue;
      }

      const box = await found.boundingBox();
      if (!box) continue;

      const annotation = step.annotation ?? "circle";
      await page.evaluate(
        (b: { x: number; y: number; width: number; height: number }, num: number, type: string) => {
          const el = document.createElement("div");
          el.className = "guide-annotation";
          el.style.cssText = `
            position: fixed;
            z-index: 99999;
            pointer-events: none;
          `;

          if (type === "circle") {
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const r = Math.max(b.width, b.height) / 2 + 8;
            el.style.left = `${cx - r}px`;
            el.style.top = `${cy - r}px`;
            el.style.width = `${r * 2}px`;
            el.style.height = `${r * 2}px`;
            el.style.border = "3px solid #ef4444";
            el.style.borderRadius = "50%";
          } else {
            el.style.left = `${b.x + b.width + 4}px`;
            el.style.top = `${b.y + b.height / 2 - 12}px`;
            el.style.width = "24px";
            el.style.height = "24px";
            el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
          }

          // Numbered badge
          const badge = document.createElement("div");
          badge.style.cssText = `
            position: absolute; top: -6px; right: -6px;
            width: 20px; height: 20px; border-radius: 50%;
            background: #ef4444; color: white;
            font-size: 11px; font-weight: bold;
            display: flex; align-items: center; justify-content: center;
            font-family: sans-serif;
          `;
          badge.textContent = String(num);
          el.appendChild(badge);

          document.body.appendChild(el);
        },
        box,
        i + 1,
        annotation,
      );
      annotationCount++;
    }

    console.log(`  Added ${annotationCount} annotations`);

    const outputPath = join(OUTPUT_DIR, entry.screenshot.file);
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(`  Saved: ${outputPath}`);

    // Remove annotations
    await page.evaluate(() => {
      document.querySelectorAll(".guide-annotation").forEach((el) => el.remove());
    });
  } catch (err) {
    console.error(`  Error processing ${entry.slug}: ${(err as Error).message}`);
  }
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1].split(",") : null;

  const entries = only
    ? ALL_GUIDE_ENTRIES.filter((e) => only.includes(e.slug))
    : ALL_GUIDE_ENTRIES;

  if (entries.length === 0) {
    console.log("No entries to process.");
    return;
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Launching browser...`);
  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Split entries: pre-auth pages first (before login), then auth-required pages
  const preAuthEntries = entries.filter((e) => PRE_AUTH_PATHS.has(e.screenshot.path));
  const authEntries = entries.filter((e) => !PRE_AUTH_PATHS.has(e.screenshot.path));

  try {
    // Phase 1: Screenshot pre-auth pages without authentication
    if (preAuthEntries.length > 0) {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(BASE_URL, { waitUntil: "networkidle2" });
      // Force light theme
      await page.evaluate(() => {
        try { localStorage.setItem("ccd_theme", "light"); } catch {}
      });
      console.log(`\n=== Phase 1: ${preAuthEntries.length} pre-auth pages (no login) ===`);
      for (const entry of preAuthEntries) {
        await processEntry(page, entry);
      }
    }

    // Phase 2: Authenticate and screenshot the rest
    if (authEntries.length > 0) {
      await setupPage(page);
      console.log(`\n=== Phase 2: ${authEntries.length} authenticated pages ===`);
      for (const entry of authEntries) {
        await processEntry(page, entry);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone! Generated ${entries.length} screenshots in ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
