// Derives ProductCategory rows from the existing, real, admin-authored
// Product.category free-text values (not invented — see docs/DECISIONS.md:
// this field is bounded/admin-curated, unlike noisy fields like
// Conversation.lostReason, so auto-deriving from it is safe). Idempotent.
import { PrismaClient } from "@prisma/client";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function main() {
  const prisma = new PrismaClient();

  const products = await prisma.product.findMany({
    where: { category: { not: null } },
    select: { id: true, category: true },
  });
  const distinctCategories = [...new Set(products.map((p) => p.category!).filter(Boolean))];
  console.log("distinct Product.category values found:", distinctCategories);

  let i = 0;
  for (const name of distinctCategories) {
    const slug = slugify(name);
    const row = await prisma.productCategory.upsert({
      where: { slug },
      create: { name, slug, sortOrder: i },
      update: { name },
    });
    const { count } = await prisma.product.updateMany({
      where: { category: name },
      data: { productCategoryId: row.id },
    });
    console.log(`  "${name}" -> ${row.id} (${count} products backfilled)`);
    i++;
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
