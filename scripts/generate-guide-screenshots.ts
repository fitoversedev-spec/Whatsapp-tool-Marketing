/**
 * Auto-generate annotated screenshots for guide entries.
 * Usage: npx tsx scripts/generate-guide-screenshots.ts [--only=slug1,slug2] [--section=whatsapp|crm|scout|platform]
 *
 * Requires dev server running at http://localhost:3000 (never run `next build`
 * against the same .next folder while capturing — it corrupts the dev server).
 *
 * A screenshot is only written when the page loaded healthy (no error page,
 * no 404, no login redirect, no "Loading…" placeholder left). Otherwise the
 * existing PNG is left untouched and the run exits non-zero.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import type { Page } from "puppeteer-core";
import {
  launchBrowser,
  setupPage,
  sleep,
  BASE_URL,
  visitPage,
  runSetupActions,
  waitForPageReady,
  pageProblem,
} from "./guide-shared";
import { ALL_GUIDE_ENTRIES } from "../src/lib/help/registry";

type Entry = (typeof ALL_GUIDE_ENTRIES)[number];
type AnnotationResult = { step: number; target: string; status: "ok" | "missing" | "offscreen" };
type EntryReport = { slug: string; file: string; ok: boolean; problems: string[] };

const OUTPUT_DIR = join(process.cwd(), "public", "guide");
const PRE_AUTH_PATHS = new Set(["/login", "/signup", "/forgot-password"]);
const ENTRY_ATTEMPTS = 3;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

async function applyViewport(page: Page, viewport: { width: number; height: number }) {
  const phone = viewport.width < 600;
  await page.setViewport({ ...viewport, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
}

async function annotate(page: Page, entry: Entry): Promise<AnnotationResult[]> {
  const targets = entry.steps
    .map((step, i) => (step.target ? { step: i + 1, target: step.target, type: step.annotation ?? "circle" } : null))
    .filter((t): t is { step: number; target: string; type: "circle" | "arrow" } => t !== null);
  if (targets.length === 0) return [];

  return page.evaluate((items) => {
    const results: { step: number; target: string; status: "ok" | "missing" | "offscreen" }[] = [];
    let scrolled = false;

    for (const item of items) {
      const el = document.querySelector<HTMLElement>(`[data-guide="${item.target}"]`);
      let rect = el?.getBoundingClientRect();
      if (!el || !rect || rect.width === 0 || rect.height === 0) {
        results.push({ step: item.step, target: item.target, status: "missing" });
        continue;
      }

      // Bring the first target into view so the screenshot actually shows it —
      // but never scroll for a target taller than most of the viewport: that
      // would push the page title off-screen for a highlight that can't fit anyway.
      const tooTall = rect.height > window.innerHeight * 0.6;
      if (!scrolled && !tooTall && (rect.top < 0 || rect.bottom > window.innerHeight)) {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
        rect = el.getBoundingClientRect();
      }
      scrolled = true;

      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        results.push({ step: item.step, target: item.target, status: "offscreen" });
        continue;
      }

      const overlay = document.createElement("div");
      overlay.className = "guide-annotation";
      overlay.style.cssText = "position:fixed;z-index:2147483000;pointer-events:none;box-sizing:border-box;";
      let badgePos = "top:-13px; left:-13px;";

      if (item.type === "arrow") {
        overlay.style.left = `${rect.right + 4}px`;
        overlay.style.top = `${rect.top + rect.height / 2 - 12}px`;
        overlay.style.width = "24px";
        overlay.style.height = "24px";
        overlay.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
      } else {
        // Small controls get a circle; anything larger gets a tight rounded box
        // so a table or section is outlined instead of swallowed by a huge circle.
        const compact = Math.max(rect.width, rect.height) <= 64;
        let left: number, top: number, width: number, height: number;
        if (compact) {
          const d = Math.max(rect.width, rect.height) + 18;
          left = rect.left + rect.width / 2 - d / 2;
          top = rect.top + rect.height / 2 - d / 2;
          width = d;
          height = d;
          overlay.style.borderRadius = "50%";
        } else {
          const pad = 5;
          left = rect.left - pad;
          top = rect.top - pad;
          width = rect.width + pad * 2;
          height = rect.height + pad * 2;
          overlay.style.borderRadius = "10px";
        }
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
        overlay.style.border = "3px solid #ef4444";
        overlay.style.boxShadow = "0 0 0 3px rgba(239,68,68,0.18)";
        // No room above/left of the box (element hugging the viewport edge): move the badge below/inside
        // so it never covers the element's own label.
        badgePos = `${top < 14 ? "bottom:-13px;" : "top:-13px;"} ${left < 14 ? "left:4px;" : "left:-13px;"}`;
      }

      const badge = document.createElement("div");
      badge.style.cssText = `
        position:absolute; ${badgePos}
        width:24px; height:24px; border-radius:50%;
        background:#ef4444; color:#fff; box-shadow:0 0 0 2px #fff;
        font:700 13px/24px sans-serif; text-align:center;
      `;
      badge.textContent = String(item.step);
      overlay.appendChild(badge);
      document.body.appendChild(overlay);
      results.push({ step: item.step, target: item.target, status: "ok" });
    }
    return results;
  }, targets);
}

async function processEntry(page: Page, entry: Entry): Promise<EntryReport> {
  const report: EntryReport = { slug: entry.slug, file: entry.screenshot.file, ok: false, problems: [] };
  console.log(`\nProcessing: ${entry.slug} → ${entry.screenshot.path}`);

  for (let attempt = 1; attempt <= ENTRY_ATTEMPTS; attempt++) {
    try {
      await page.evaluate(() => {
        try { sessionStorage.clear(); } catch {}
      });
      await applyViewport(page, entry.screenshot.viewport ?? DEFAULT_VIEWPORT);
      await visitPage(page, entry.screenshot.path);
      if (entry.screenshot.setup?.length) {
        await runSetupActions(page, entry.screenshot.setup);
        await waitForPageReady(page);
      }

      const problem = await pageProblem(page);
      if (problem) throw new Error(`${problem} after setup`);

      // Wait for every target: after a setup click into a not-yet-compiled route, targets that only exist on the
      // destination page prove the navigation finished (a slow server can otherwise be captured mid-navigation).
      const targetIds = entry.steps.flatMap((s) => (s.target ? [s.target] : []));
      await Promise.all(
        targetIds.map((id) => page.waitForSelector(`[data-guide="${id}"]`, { timeout: 30000 }).catch(() => {})),
      );
      if (targetIds.length > 0) await sleep(500);

      const results = await annotate(page, entry);
      const bad = results.filter((r) => r.status !== "ok");
      const ok = results.length - bad.length;
      console.log(`  Annotated ${ok}/${results.length} targets`);
      for (const b of bad) {
        const msg = `step ${b.step} target "${b.target}" ${b.status === "missing" ? "not found on page" : "is off-screen"}`;
        console.warn(`  Warning: ${msg}`);
        report.problems.push(msg);
      }

      const blurCss = (entry.screenshot.blur ?? []).map((sel) => `${sel}{filter:blur(7px)!important}`).join("\n");
      await page.addStyleTag({ content: `nextjs-portal{display:none!important}\n${blurCss}` });
      await sleep(150);
      const outputPath = join(OUTPUT_DIR, entry.screenshot.file);
      // Capture to a temp file first so a blank render can never overwrite a good screenshot.
      const tempPath = `${outputPath}.tmp.png`;
      await page.screenshot({ path: tempPath as `${string}.png`, type: "png", fullPage: false });
      if (statSync(tempPath).size < 12_000) {
        unlinkSync(tempPath);
        throw new Error("the screenshot came out blank");
      }
      renameSync(tempPath, outputPath);
      console.log(`  Saved: ${outputPath}`);

      await page.evaluate(() => {
        document.querySelectorAll(".guide-annotation").forEach((el) => el.remove());
      });
      report.ok = true;
      if (entry.screenshot.viewport) await applyViewport(page, DEFAULT_VIEWPORT);
      return report;
    } catch (err) {
      console.warn(`  Attempt ${attempt}/${ENTRY_ATTEMPTS} failed: ${(err as Error).message}`);
      await sleep(2000);
    }
  }
  if (entry.screenshot.viewport) await applyViewport(page, DEFAULT_VIEWPORT);

  report.problems.push("could not capture a healthy page — existing screenshot left untouched");
  return report;
}

function reportDuplicates(generated: Set<string>): string[][] {
  const byHash = new Map<string, string[]>();
  for (const entry of ALL_GUIDE_ENTRIES) {
    const path = join(OUTPUT_DIR, entry.screenshot.file);
    if (!existsSync(path)) continue;
    const hash = createHash("md5").update(readFileSync(path)).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), entry.screenshot.file]);
  }
  return [...byHash.values()].filter((files) => files.length > 1 && files.some((f) => generated.has(f)));
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const sectionArg = process.argv.find((a) => a.startsWith("--section="));
  const only = onlyArg ? onlyArg.split("=")[1].split(",") : null;
  const section = sectionArg ? sectionArg.split("=")[1] : null;

  const entries = ALL_GUIDE_ENTRIES.filter(
    (e) => (!only || only.includes(e.slug)) && (!section || e.section === section),
  );

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
  const reports: EntryReport[] = [];

  try {
    // Phase 1: Screenshot pre-auth pages without authentication
    if (preAuthEntries.length > 0) {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 120000 });
      // Force light theme
      await page.evaluate(() => {
        try { localStorage.setItem("ccd_theme", "light"); } catch {}
      });
      console.log(`\n=== Phase 1: ${preAuthEntries.length} pre-auth pages (no login) ===`);
      for (const entry of preAuthEntries) {
        reports.push(await processEntry(page, entry));
      }
    }

    // Phase 2: Authenticate and screenshot the rest
    if (authEntries.length > 0) {
      await setupPage(page);
      console.log(`\n=== Phase 2: ${authEntries.length} authenticated pages ===`);
      for (const entry of authEntries) {
        reports.push(await processEntry(page, entry));
      }
    }
  } finally {
    await browser.close();
  }

  const failed = reports.filter((r) => !r.ok);
  const withProblems = reports.filter((r) => r.ok && r.problems.length > 0);
  const duplicates = reportDuplicates(new Set(reports.filter((r) => r.ok).map((r) => r.file)));

  console.log(`\n=== Summary ===`);
  console.log(`Captured ${reports.length - failed.length}/${reports.length} screenshots in ${OUTPUT_DIR}`);
  for (const r of failed) console.log(`FAILED  ${r.slug}: ${r.problems.join("; ")}`);
  for (const r of withProblems) console.log(`TARGETS ${r.slug}: ${r.problems.join("; ")}`);
  for (const files of duplicates) console.log(`IDENTICAL images: ${files.join(" = ")}`);
  if (failed.length + withProblems.length + duplicates.length === 0) console.log("All clean.");

  process.exitCode = failed.length + withProblems.length + duplicates.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
