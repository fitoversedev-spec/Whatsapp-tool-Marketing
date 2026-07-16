// One-time correction: Conversation.pipelineStage held the OLD, separate
// 7-stage vocabulary (new/qualified/demo_scheduled/proposal_sent/
// negotiation/won/lost) that /pipeline used to read from a hardcoded
// config. /pipeline now reads the real 13-row FunnelStage taxonomy
// directly (see docs/DECISIONS.md), so existing rows need remapping to
// the closest new slug — otherwise they'd fall into the client's
// unrecognized-stage fallback (the earliest stage) silently.
//
// Same many-to-one reasoning transitionDeal.ts's now-removed
// REVERSE_LEGACY_STAGE_SLUG used: each old slug resolves to the EARLIEST
// (lowest sortOrder) new stage among its candidates.
//
// Idempotent — safe to re-run. Only touches rows whose pipelineStage is
// still one of the 7 old values; already-migrated rows are untouched.
//
//   npx tsx scripts/backfill-pipeline-stage-vocabulary.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OLD_TO_NEW_SLUG: Record<string, string> = {
  new: "enquiry_received",
  qualified: "contacted_qualified",
  demo_scheduled: "design_shared",
  proposal_sent: "quotation_sent",
  negotiation: "negotiation",
  won: "won_po_advance_received",
  lost: "lost_rejected",
};

async function main() {
  let totalUpdated = 0;
  for (const [oldSlug, newSlug] of Object.entries(OLD_TO_NEW_SLUG)) {
    const result = await prisma.conversation.updateMany({
      where: { pipelineStage: oldSlug },
      data: { pipelineStage: newSlug },
    });
    if (result.count > 0) {
      console.log(`  ${oldSlug} -> ${newSlug}: ${result.count} conversation(s)`);
      totalUpdated += result.count;
    }
  }
  console.log(`\nDone. ${totalUpdated} conversation(s) migrated to the new stage vocabulary.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
