// One-shot — reads the 5 PDFs the customer dropped in
// D:\Fitoverse.pvt\Catalogue\, uploads each to Vercel Blob, and stores
// the resulting URL in the Setting table under
// `catalogue_<sport>_url`. The catalogue send + preview routes pick up
// this Setting and serve the uploaded PDF directly instead of running
// the auto-generator.
//
// Re-run anytime the catalogues are updated:
//   npx tsx scripts/upload-sport-catalogues.ts
//
// Requires BLOB_READ_WRITE_TOKEN in the environment (same token the
// production app uses to write images/PDFs to Vercel Blob).

import * as fs from "fs";
import * as path from "path";
// Manually parse .env so OneDrive doesn't lock dotenv during cold module
// load (errno -4094). The script only needs DATABASE_URL +
// BLOB_READ_WRITE_TOKEN, so a 5-line .env parser is enough.
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      const [, k, vRaw] = m;
      const v = vRaw.replace(/^['"]|['"]$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
import { put } from "@vercel/blob";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FILES: { sport: string; path: string }[] = [
  { sport: "football", path: "D:/Fitoverse.pvt/Catalogue/Football.pdf" },
  { sport: "basketball", path: "D:/Fitoverse.pvt/Catalogue/Basket ball.pdf" },
  { sport: "badminton", path: "D:/Fitoverse.pvt/Catalogue/Badmintion.pdf" },
  { sport: "pickleball", path: "D:/Fitoverse.pvt/Catalogue/Pickle ball.pdf" },
  { sport: "multisport", path: "D:/Fitoverse.pvt/Catalogue/Multi Sport.pdf" },
];

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("ERROR: BLOB_READ_WRITE_TOKEN missing from environment.");
    console.error(
      "Copy it from your Vercel project's Storage tab → .env.local view, paste into .env, retry."
    );
    process.exit(2);
  }

  for (const f of FILES) {
    if (!fs.existsSync(f.path)) {
      console.warn(`  skip ${f.sport}: file not found at ${f.path}`);
      continue;
    }
    const bytes = fs.readFileSync(f.path);
    const sizeMb = (bytes.length / 1024 / 1024).toFixed(1);
    console.log(`UP  ${f.sport.padEnd(12)} (${sizeMb} MB)`);
    const blob = await put(
      `catalogues/fitoverse-${f.sport}-catalogue.pdf`,
      bytes,
      {
        access: "public",
        contentType: "application/pdf",
        addRandomSuffix: false,
        allowOverwrite: true,
      }
    );
    await prisma.setting.upsert({
      where: { key: `catalogue_${f.sport}_url` },
      create: { key: `catalogue_${f.sport}_url`, value: blob.url },
      update: { value: blob.url },
    });
    console.log(`    -> ${blob.url}`);
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
