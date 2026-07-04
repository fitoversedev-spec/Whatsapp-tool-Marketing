// Smoke test: hit the real MVPv2 API through our client and print
// what a WhatsApp customer would see for a few sample sports.
// Run: npx tsx scripts/smoke-mvpv2.ts

// dotenv is optional here — the client uses a hard-coded fallback URL.
import {
  listProductsBySport,
  getProduct,
  listSports,
  htmlToWhatsappText,
  specsToWhatsappBlock,
  _baseUrl,
} from "@/lib/mvpv2/products";
import type { SportKey } from "@/lib/catalogue/sport-meta";

async function main() {
  console.log("MVPV2 base:", _baseUrl());

  console.log("\n=== SPORTS META ===");
  const sports = await listSports();
  console.log(sports.map((s) => `  ${s.id.padEnd(12)} ${s.name}`).join("\n"));

  console.log("\n=== INVENTORY BY SPORT ===");
  const allSports: SportKey[] = [
    "football",
    "basketball",
    "cricket",
    "pickleball",
    "volleyball",
    "tennis",
    "badminton",
    "multisport",
  ];
  const counts: Record<string, number> = {};
  for (const sport of allSports) {
    const products = await listProductsBySport(sport);
    counts[sport] = products.length;
    console.log(`  ${sport.padEnd(12)} ${products.length} products`);
  }

  const sample: SportKey[] = ["football", "cricket"];
  for (const sport of sample) {
    console.log(`\n=== ${sport.toUpperCase()} ===`);
    const products = await listProductsBySport(sport);
    console.log(`  count: ${products.length}`);
    for (const p of products.slice(0, 5)) {
      console.log(`  - ${p.name.trim()}  (${p.id})`);
      console.log(`      hero: ${p.image_url ?? "(none)"}`);
      console.log(
        `      cats: ${p.categories.map((c) => c.name).join(", ") || "(none)"}`,
      );
    }
    if (!products[0]) continue;
    const full = await getProduct(products[0].id);
    if (!full) continue;
    console.log(`\n--- WhatsApp render preview: "${full.name.trim()}" ---`);
    console.log("BODY:");
    console.log(htmlToWhatsappText(full.description).slice(0, 600));
    console.log("SPECS:");
    console.log(specsToWhatsappBlock(full.specs) || "(no structured specs)");
    console.log("GALLERY:");
    console.log(
      (full.images ?? []).map((i) => `  ${i.image_url}`).join("\n") || "  (none)",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("smoke test failed:", err);
    process.exit(1);
  });
