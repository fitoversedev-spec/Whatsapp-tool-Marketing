// One-time import of MVPv2 products into the internal catalogue.
//
// Pulls every product from fitoverse.vercel.app/api/products (per sport),
// dedupes by MVPv2 id, classifies each into flooring | material |
// equipment, and creates a Product row (+ specs, sports, hero image).
// After this runs, we cut the live MVPv2 connection (Phase C).
//
// Run:   npx tsx scripts/import-mvpv2-products.ts
// Idempotent-ish: skips products whose name already exists in the DB,
// so re-running won't create duplicates.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MVPV2 = "https://fitoverse.vercel.app/api";
const SPORTS = [
  "football",
  "cricket",
  "basketball",
  "pickleball",
  "tennis",
  "badminton",
  "volleyball",
  "multisport",
];

type MvpProduct = {
  id: string;
  name: string;
  description: string;
  image_url: string | null;
  specs: Record<string, string> | null;
  sports?: Array<{ id: string }>;
  categories?: Array<{ name: string }>;
};

// Best-effort type classification from the product's categories + name.
function classify(p: MvpProduct): "flooring" | "material" | "equipment" {
  const hay = [
    ...(p.categories ?? []).map((c) => c.name),
    p.name,
  ]
    .join(" ")
    .toLowerCase();
  if (
    /turf|acrylic|flooring|artificial|pvc|tile|pitch mat|court surface|vinyl/.test(
      hay,
    )
  )
    return "flooring";
  if (
    /light|led|net|post|goal|machine|stump|bail|scoreboard|shot clock|bench|seating|equipment|racket|ball|paddle|shuttle/.test(
      hay,
    )
  )
    return "equipment";
  return "material";
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "admin" },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) {
    console.error("No admin user found — seed one first.");
    process.exit(1);
  }

  console.log("Fetching MVPv2 products per sport…");
  const byId = new Map<string, { p: MvpProduct; sports: Set<string> }>();
  for (const sport of SPORTS) {
    const r = await fetch(`${MVPV2}/products?sport=${sport}`).catch(() => null);
    if (!r || !r.ok) {
      console.warn(`  ${sport}: fetch failed`);
      continue;
    }
    const j = (await r.json()) as { products?: MvpProduct[] };
    const products = j.products ?? [];
    console.log(`  ${sport}: ${products.length}`);
    for (const p of products) {
      const existing = byId.get(p.id);
      if (existing) {
        existing.sports.add(sport);
      } else {
        byId.set(p.id, { p, sports: new Set([sport]) });
      }
    }
  }

  console.log(`\nUnique products: ${byId.size}`);
  let created = 0;
  let skipped = 0;
  for (const { p, sports } of byId.values()) {
    const name = p.name.trim();
    const dupe = await prisma.product.findFirst({ where: { name } });
    if (dupe) {
      skipped++;
      continue;
    }
    // Prefer the MVPv2 sports array if present, else the sport buckets
    // we found the product under.
    const sportKeys = Array.from(
      new Set([
        ...(p.sports ?? []).map((s) => s.id),
        ...Array.from(sports),
      ]),
    );
    await prisma.product.create({
      data: {
        name,
        type: classify(p),
        description: p.description ?? "",
        sports: JSON.stringify(sportKeys),
        category: p.categories?.[0]?.name ?? null,
        heroImageUrl: p.image_url ?? null,
        specs: JSON.stringify(p.specs ?? {}),
        createdByUserId: admin.id,
      },
    });
    created++;
  }

  console.log(`\nCreated ${created}, skipped ${skipped} (already present).`);
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
