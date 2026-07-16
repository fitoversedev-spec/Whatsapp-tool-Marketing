// One-time correction: Deal.ownerUserId should never be null (every
// creation path already sets it — see docs/DECISIONS.md), so any existing
// null is a historical anomaly, not an intentional "unassigned" state.
// transitionDeal() now self-heals this going forward (claims ownership for
// whoever performs a real transition on a null-owner deal); this script
// applies the same correction to whatever's already null.
//
// Priority signal per deal: most recent DealStageHistory.changedByUserId
// (whoever actually worked it most recently) -> Conversation.assignedToUserId
// -> Account.ownerUserId -> left null if genuinely no signal exists (never
// guessed).
//
// Idempotent — only touches rows where ownerUserId is currently null.
//
//   npx tsx scripts/fix-deal-null-owners.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const nullOwnerDeals = await prisma.deal.findMany({
    where: { ownerUserId: null, deletedAt: null },
    select: {
      id: true,
      code: true,
      conversation: { select: { assignedToUserId: true } },
      account: { select: { ownerUserId: true } },
    },
  });

  if (!nullOwnerDeals.length) {
    console.log("No null-owner deals found. Nothing to do.");
    return;
  }

  let fixed = 0;
  let skipped = 0;
  for (const d of nullOwnerDeals) {
    const lastHistory = await prisma.dealStageHistory.findFirst({
      where: { dealId: d.id, changedByUserId: { not: null } },
      orderBy: { changedAt: "desc" },
      select: { changedByUserId: true },
    });
    const ownerUserId = lastHistory?.changedByUserId ?? d.conversation?.assignedToUserId ?? d.account?.ownerUserId ?? null;
    if (!ownerUserId) {
      console.log(`  ${d.code}: no signal available (no history, no assigned conversation, no account owner) — left null`);
      skipped++;
      continue;
    }
    await prisma.deal.update({ where: { id: d.id }, data: { ownerUserId } });
    console.log(`  ${d.code}: ownerUserId -> ${ownerUserId}`);
    fixed++;
  }

  console.log(`\nDone. ${fixed} deal(s) corrected, ${skipped} left null (no signal).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
