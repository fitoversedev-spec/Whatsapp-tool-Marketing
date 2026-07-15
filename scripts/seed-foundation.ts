// Phase 0 foundation seed — Office rows only so far. Idempotent (upsert on
// the unique slug), safe to re-run. Run with DATABASE_URL pointed at the
// target DB, e.g.:
//   DATABASE_URL="$DEV_DATABASE_URL" npx tsx scripts/seed-foundation.ts
import { PrismaClient } from "@prisma/client";

const OFFICES = [
  { name: "Salem", slug: "salem", city: "Salem" },
  { name: "Chennai", slug: "chennai", city: "Chennai" },
  { name: "Bangalore", slug: "bangalore", city: "Bangalore" },
];

async function main() {
  const prisma = new PrismaClient();
  for (const o of OFFICES) {
    const row = await prisma.office.upsert({
      where: { slug: o.slug },
      create: o,
      update: { name: o.name, city: o.city },
    });
    console.log("office:", row.slug, "->", row.id);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
