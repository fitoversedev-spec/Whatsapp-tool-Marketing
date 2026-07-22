// One-time cleanup, per explicit decision (2026-07-22): retiring the
// dealChannel:"whatsapp" auto-create path in favor of the Inbox's "Move to
// CRM" flow — every deal from here on is dealChannel:"crm". Soft-deletes
// (sets deletedAt, never a hard delete) every existing dealChannel:"whatsapp"
// deal so they drop out of every list/analytics screen, same as any other
// deleted deal, while staying recoverable in the database if anything still
// needs them.
//
// Idempotent — only touches rows where dealChannel is "whatsapp" AND
// deletedAt is still null, so re-running after a successful run finds
// nothing left to do.
//
//   npx tsx scripts/soft-delete-legacy-whatsapp-deals.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const deals = await prisma.deal.findMany({
    where: { dealChannel: "whatsapp", deletedAt: null },
    select: { id: true, code: true, title: true, outcome: true, createdAt: true, account: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (!deals.length) {
    console.log("No dealChannel:whatsapp deals found. Nothing to do.");
    return;
  }

  console.log(`Soft-deleting ${deals.length} legacy WhatsApp-channel deal(s):\n`);
  for (const d of deals) {
    console.log(`  ${d.code} | ${d.account.name} | ${d.title} | outcome=${d.outcome ?? "open"} | created ${d.createdAt.toISOString().slice(0, 10)}`);
  }

  const now = new Date();
  const result = await prisma.deal.updateMany({
    where: { id: { in: deals.map((d) => d.id) } },
    data: { deletedAt: now },
  });

  console.log(`\nDone. ${result.count} deal(s) soft-deleted (deletedAt = ${now.toISOString()}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
