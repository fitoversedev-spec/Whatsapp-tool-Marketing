/**
 * Auto-record section overview videos using Puppeteer screencast.
 * Usage: npx tsx scripts/generate-guide-recordings.ts [--only=whatsapp|crm|scout]
 *
 * Requires dev server running at http://localhost:3000
 * Uploads to Vercel Blob and updates video-manifest.ts
 */
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { launchBrowser, setupPage, sleep, BASE_URL } from "./guide-shared";
import { GUIDE_SECTIONS } from "../src/lib/help/registry";
import { getRecordingForSection } from "../src/lib/help/registry";
import type { GuideSectionId, RecordingAction } from "../src/lib/help/types";

const TEMP_DIR = join(process.cwd(), ".next", "guide-recordings");
const MANIFEST_PATH = join(process.cwd(), "src", "lib", "help", "video-manifest.ts");

async function executeAction(page: import("puppeteer-core").Page, action: RecordingAction) {
  switch (action.type) {
    case "navigate":
      await page.goto(`${BASE_URL}${action.url}`, { waitUntil: "networkidle2" });
      break;
    case "click":
      try { await page.click(action.selector); } catch { console.warn(`  Click target not found: ${action.selector}`); }
      await sleep(800);
      break;
    case "hover":
      try { await page.hover(action.selector); } catch { console.warn(`  Hover target not found: ${action.selector}`); }
      await sleep(600);
      break;
    case "scroll":
      await page.evaluate(
        (sel: string | undefined, dir: string, amt: number) => {
          const el = sel ? document.querySelector(sel) : document.scrollingElement;
          el?.scrollBy({ top: dir === "down" ? amt : -amt, behavior: "smooth" });
        },
        action.selector,
        action.direction,
        action.amount ?? 300,
      );
      await sleep(800);
      break;
    case "type":
      try { await page.type(action.selector, action.text, { delay: 80 }); } catch { console.warn(`  Type target not found: ${action.selector}`); }
      break;
    case "wait":
      await sleep(action.duration);
      break;
    case "highlight": {
      try {
        await page.evaluate(
          (sel: string, label?: string) => {
            const el = document.querySelector(sel);
            if (!el) return;
            const box = el.getBoundingClientRect();
            const overlay = document.createElement("div");
            overlay.id = "guide-highlight";
            overlay.style.cssText = `
              position: fixed; z-index: 99999; pointer-events: none;
              left: ${box.left - 6}px; top: ${box.top - 6}px;
              width: ${box.width + 12}px; height: ${box.height + 12}px;
              border: 3px solid #6366f1; border-radius: 8px;
              box-shadow: 0 0 0 4px rgba(99,102,241,0.2);
            `;
            if (label) {
              const lbl = document.createElement("div");
              lbl.style.cssText = `
                position: absolute; top: -28px; left: 0;
                background: #6366f1; color: white; padding: 2px 8px;
                border-radius: 4px; font-size: 12px; font-weight: bold;
                font-family: sans-serif; white-space: nowrap;
              `;
              lbl.textContent = label;
              overlay.appendChild(lbl);
            }
            document.body.appendChild(overlay);
          },
          action.selector,
          action.label,
        );
      } catch { console.warn(`  Highlight target not found: ${action.selector}`); }
      await sleep(1500);
      await page.evaluate(() => document.getElementById("guide-highlight")?.remove());
      break;
    }
  }
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1].split(",") as GuideSectionId[] : null;

  const sections = only
    ? GUIDE_SECTIONS.filter((s) => only.includes(s.id))
    : GUIDE_SECTIONS;

  mkdirSync(TEMP_DIR, { recursive: true });

  console.log("Launching browser...");
  const browser = await launchBrowser();
  const page = await browser.newPage();

  const urls: Record<string, string> = {};

  try {
    await setupPage(page);

    for (const section of sections) {
      const result = getRecordingForSection(section.id);
      if (!result) {
        console.log(`No recording script for ${section.id}, skipping`);
        continue;
      }

      const { recording } = result;
      console.log(`\nRecording: ${recording.title} (${recording.slug})`);

      const tempFile = join(TEMP_DIR, `${recording.slug}.webm`);
      await page.goto(`${BASE_URL}${recording.startUrl}`, { waitUntil: "networkidle2" });
      await sleep(1000);

      // Start screencast
      const recorder = await page.screencast({ path: tempFile });

      for (const action of recording.actions) {
        console.log(`  Action: ${action.type}${("selector" in action && action.selector) ? ` → ${action.selector}` : ""}`);
        await executeAction(page, action);
      }

      await recorder.stop();
      console.log(`  Saved local: ${tempFile}`);

      // Upload to Vercel Blob
      try {
        const { uploadToBlob } = await import("../src/lib/media");
        const bytes = readFileSync(tempFile);
        const blobResult = await uploadToBlob({
          bytes,
          fileName: `guide/${recording.slug}.webm`,
          mimeType: "video/webm",
          folder: "guide",
        });
        urls[recording.slug] = blobResult.url;
        console.log(`  Uploaded to Blob: ${blobResult.url}`);
      } catch (err) {
        console.warn(`  Blob upload skipped (${(err as Error).message}). Local file saved.`);
      }
    }
  } finally {
    await browser.close();
  }

  // Update video manifest
  if (Object.keys(urls).length > 0) {
    const manifest = `// Auto-generated by scripts/generate-guide-recordings.ts — do not edit manually\nexport const VIDEO_URLS: Record<string, string> = ${JSON.stringify(urls, null, 2)};\n`;
    writeFileSync(MANIFEST_PATH, manifest, "utf-8");
    console.log(`\nUpdated video manifest: ${MANIFEST_PATH}`);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
