// One-time correction: isPrimary was never actually demoted on any
// quotation before the fix in POST /api/quotations (see docs/DECISIONS.md),
// so every quotation ever created — including all revisions on a deal with
// several — is currently isPrimary:true. This sets exactly one primary per
// deal (the most recently created quotation), false on the rest. Idempotent
// — safe to re-run; always recomputes from scratch rather than trusting
// prior state.
//
//   npx tsx scripts/fix-quotation-isprimary.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const deals = await prisma.deal.findMany({
    select: { id: true, code: true, quotations: { select: { id: true, number: true, createdAt: true }, orderBy: { createdAt: "desc" } } },
  });

  let dealsFixed = 0;
  let quotesChanged = 0;
  for (const deal of deals) {
    if (deal.quotations.length === 0) continue;
    const [primary, ...rest] = deal.quotations; // already sorted desc by createdAt
    const currentPrimaryIds = new Set(deal.quotations.map((q) => q.id));

    const demoteResult = await prisma.quotation.updateMany({
      where: { id: { in: rest.map((q) => q.id) }, isPrimary: true },
      data: { isPrimary: false },
    });
    const promoteResult = await prisma.quotation.updateMany({
      where: { id: primary.id, isPrimary: false },
      data: { isPrimary: true },
    });

    if (demoteResult.count > 0 || promoteResult.count > 0) {
      dealsFixed++;
      quotesChanged += demoteResult.count + promoteResult.count;
      console.log(`  ${deal.code}: primary -> ${primary.number}, demoted ${demoteResult.count} other revision(s)`);
    }
  }

  console.log(`\nDone. ${dealsFixed} deal(s) corrected, ${quotesChanged} quotation row(s) changed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
