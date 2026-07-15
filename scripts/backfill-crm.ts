// One-time backfill: links existing Conversations/Quotations/CourtImages/
// BotLeads (all pre-dating the CRM layer) into Account/Deal/Lead/
// DealLineItem, so Phase 4 analytics have real history instead of only
// deals created going forward through the new UI.
//
// Idempotent — safe to re-run. Every unit is selected by dealId/leadId ==
// null, so already-linked rows are skipped on a second run; a conversation
// that already has a backfilled Deal gets any newly-orphaned quotes/designs
// attached to that SAME deal rather than a duplicate.
//
//   DATABASE_URL="$DEV_DATABASE_URL" npx tsx scripts/backfill-crm.ts
//
// Known limitation (see docs/DECISIONS.md): account de-dup is exact
// case-insensitive name match — the same rule the live "possible duplicate"
// check in POST /api/deals uses. Walk-in quotes often carry short/generic
// customerName values ("WR", "mh", "Test1"), so this can merge unrelated
// customers who happen to share a name, or fail to merge the same customer
// spelled differently. This is a best-effort reconstruction of history, not
// verified lineage — an admin can re-parent Deals to a different Account
// later if a mismatch surfaces.
//
// outcome/closedAt are deliberately left null for every backfilled deal —
// whether a historical quote actually turned into a won or lost project is
// not recoverable from the data that exists, and must not be invented.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type StoredLineItem = {
  name: string;
  areaSqFt: number;
  ratePerSqFt: number;
  total: number;
  included?: boolean;
  productId?: string | null;
  unit?: string | null;
};

function buildDealCode(year: number, existingThisYear: number): string {
  const seq = String(existingThisYear + 1).padStart(3, "0");
  return `FIT-DL-${year}-${seq}`;
}

async function nextDealSequenceForYear(year: number): Promise<number> {
  const prefix = `FIT-DL-${year}-`;
  const latest = await prisma.deal.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  if (!latest) return 1;
  const seq = parseInt(latest.code.slice(prefix.length), 10);
  return Number.isFinite(seq) ? seq + 1 : 1;
}

// In-memory per-year counter — safe because this script is a single
// sequential run with no concurrent writers.
const seqCache = new Map<number, number>();
async function nextDealCode(year: number): Promise<string> {
  let nextSeq = seqCache.get(year);
  if (nextSeq == null) nextSeq = await nextDealSequenceForYear(year);
  seqCache.set(year, nextSeq + 1);
  return buildDealCode(year, nextSeq - 1);
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

async function resolveAccountId(name: string, ownerUserId: string | null, phone: string | null): Promise<string> {
  const trimmed = name.trim() || "Unknown customer";
  const existing = await prisma.account.findFirst({
    where: { deletedAt: null, name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const account = await prisma.account.create({
    data: { name: trimmed, ownerUserId: ownerUserId ?? undefined },
  });
  if (phone) {
    await prisma.accountContact.create({
      data: { accountId: account.id, name: trimmed, phone, isPrimary: true },
    });
  }
  return account.id;
}

function pickPrimaryQuote<T extends { status: string; sentAt: Date | null; createdAt: Date }>(quotes: T[]): T | null {
  const sent = quotes.filter((q) => q.status === "sent").sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));
  if (sent.length) return sent[0];
  const rest = [...quotes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rest[0] ?? null;
}

function earliestSentAt(quotes: { status: string; sentAt: Date | null }[]): Date | null {
  const sentTimes = quotes.filter((q) => q.status === "sent" && q.sentAt).map((q) => q.sentAt!.getTime());
  return sentTimes.length ? new Date(Math.min(...sentTimes)) : null;
}

async function writeLineItemsForQuote(q: { id: string; lineItems: string; sport: string }, dealId: string): Promise<number> {
  let items: StoredLineItem[];
  try {
    const parsed = JSON.parse(q.lineItems);
    if (!Array.isArray(parsed)) return 0;
    items = parsed;
  } catch {
    return 0;
  }
  // Historical rows may predate the `included` field entirely — treat
  // missing as included rather than silently dropping real line items.
  const included = items.filter((li) => li.included !== false && li.name && li.areaSqFt != null);
  if (!included.length) return 0;

  const [sport, products] = await Promise.all([
    prisma.sport.findUnique({ where: { slug: q.sport } }),
    prisma.product.findMany({
      where: { name: { in: included.map((li) => li.name.trim()), mode: "insensitive" } },
      select: { id: true, name: true },
    }),
  ]);
  const productByName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p.id]));

  await prisma.dealLineItem.createMany({
    data: included.map((li) => ({
      dealId,
      quotationId: q.id,
      productId: li.productId ?? productByName.get(li.name.trim().toLowerCase()) ?? null,
      sportId: sport?.id ?? null,
      label: li.name,
      quantity: li.areaSqFt,
      unit: li.unit ?? null,
      rate: li.ratePerSqFt,
      amount: li.total,
      isEnquiryOnly: false,
    })),
  });
  return included.length;
}

function mapBotLeadStatus(status: string): string {
  switch (status) {
    case "converted":
      return "QUALIFIED";
    case "contacted":
    case "in_progress":
      return "CONTACTED";
    case "lost":
      return "DISQUALIFIED";
    default:
      return "NEW";
  }
}

async function main() {
  console.log("=== CRM backfill starting ===");

  const quotationSentStage = await prisma.funnelStage.findUnique({ where: { slug: "quotation_sent" } });
  const enquiryStage = await prisma.funnelStage.findFirst({
    where: { isActive: true, stageType: "active" },
    orderBy: { sortOrder: "asc" },
  });
  if (!quotationSentStage || !enquiryStage) {
    throw new Error("FunnelStage taxonomy not seeded — run scripts/seed-taxonomies.ts first");
  }

  let dealsCreated = 0;
  let dealsReused = 0;
  let quotesLinked = 0;
  let designsLinked = 0;
  let lineItemsWritten = 0;

  // ---- 1. Conversation-grouped: one Deal per conversation with any
  // not-yet-linked quote or design, covering ALL of that conversation's
  // quotes/designs (not just the new ones), so a single deal is reused
  // across re-runs instead of duplicated. ----
  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [{ quotations: { some: { dealId: null } } }, { courtImages: { some: { dealId: null } } }],
    },
    select: { id: true, contactName: true, contactPhone: true, createdAt: true, assignedToUserId: true },
  });

  for (const convo of conversations) {
    try {
      const [orphanQuotes, orphanDesigns] = await Promise.all([
        prisma.quotation.findMany({ where: { conversationId: convo.id, dealId: null } }),
        prisma.courtImage.findMany({ where: { conversationId: convo.id, dealId: null } }),
      ]);
      if (orphanQuotes.length === 0 && orphanDesigns.length === 0) continue;

      let deal = await prisma.deal.findFirst({ where: { conversationId: convo.id } });

      if (!deal) {
        const accountName = convo.contactName?.trim() || `Customer ${convo.contactPhone}`;
        const accountId = await resolveAccountId(accountName, convo.assignedToUserId, convo.contactPhone);
        const anySent = orphanQuotes.some((q) => q.status === "sent");
        const primary = pickPrimaryQuote(orphanQuotes);
        const year = convo.createdAt.getFullYear();

        deal = await prisma.deal.create({
          data: {
            code: await nextDealCode(year),
            title: primary ? `${titleCase(primary.sport)} — ${accountName}` : accountName,
            accountId,
            ownerUserId: convo.assignedToUserId,
            currentStageId: anySent ? quotationSentStage.id : enquiryStage.id,
            conversationId: convo.id,
            quotedValue: primary ? primary.grandTotal : null,
            enquiryAt: convo.createdAt,
            firstQuotedAt: earliestSentAt(orphanQuotes),
          },
        });
        dealsCreated++;
        console.log(`  + Deal ${deal.code} for conversation ${convo.id} (${accountName})`);
      } else {
        dealsReused++;
      }

      for (const q of orphanQuotes) {
        await prisma.quotation.update({ where: { id: q.id }, data: { dealId: deal.id } });
        quotesLinked++;
        lineItemsWritten += await writeLineItemsForQuote(q, deal.id);
      }
      for (const d of orphanDesigns) {
        await prisma.courtImage.update({ where: { id: d.id }, data: { dealId: deal.id } });
        designsLinked++;
      }
    } catch (err) {
      console.error(`  ERROR conversation ${convo.id}:`, err);
    }
  }

  // ---- 2. Standalone quotations (no conversation) — one Deal each. ----
  const standaloneQuotes = await prisma.quotation.findMany({ where: { conversationId: null, dealId: null } });
  for (const q of standaloneQuotes) {
    try {
      const accountName = q.customerName?.trim() || "Unknown customer";
      const accountId = await resolveAccountId(accountName, q.createdByUserId, q.contactPhone);
      const year = q.createdAt.getFullYear();

      const deal = await prisma.deal.create({
        data: {
          code: await nextDealCode(year),
          title: `${titleCase(q.sport)} — ${accountName}`,
          accountId,
          ownerUserId: q.createdByUserId,
          currentStageId: q.status === "sent" ? quotationSentStage.id : enquiryStage.id,
          quotedValue: q.grandTotal,
          enquiryAt: q.createdAt,
          firstQuotedAt: q.status === "sent" ? q.sentAt : null,
        },
      });
      dealsCreated++;
      await prisma.quotation.update({ where: { id: q.id }, data: { dealId: deal.id } });
      quotesLinked++;
      lineItemsWritten += await writeLineItemsForQuote(q, deal.id);
      console.log(`  + Deal ${deal.code} for standalone quote ${q.number} (${accountName})`);
    } catch (err) {
      console.error(`  ERROR standalone quotation ${q.id}:`, err);
    }
  }

  // ---- 3. Standalone court images (defensive — none exist today, every
  // CourtImage currently has a conversationId, but a future direct-create
  // path could produce one). ----
  const standaloneDesigns = await prisma.courtImage.findMany({ where: { conversationId: null, dealId: null } });
  for (const d of standaloneDesigns) {
    try {
      const accountName = d.customerName?.trim() || "Unknown customer";
      const accountId = await resolveAccountId(accountName, d.createdByUserId, d.contactPhone);
      const year = d.createdAt.getFullYear();

      const deal = await prisma.deal.create({
        data: {
          code: await nextDealCode(year),
          title: accountName,
          accountId,
          ownerUserId: d.createdByUserId,
          currentStageId: enquiryStage.id,
          enquiryAt: d.createdAt,
        },
      });
      dealsCreated++;
      await prisma.courtImage.update({ where: { id: d.id }, data: { dealId: deal.id } });
      designsLinked++;
      console.log(`  + Deal ${deal.code} for standalone court design ${d.number} (${accountName})`);
    } catch (err) {
      console.error(`  ERROR standalone court image ${d.id}:`, err);
    }
  }

  // ---- 4. BotLead -> Lead backfill ----
  const whatsappSource = await prisma.leadSource.findUnique({ where: { slug: "whatsapp_inbound" } });
  const orphanBotLeads = await prisma.botLead.findMany({ where: { leadId: null } });
  let leadsCreated = 0;
  for (const bl of orphanBotLeads) {
    try {
      const lead = await prisma.lead.create({
        data: {
          name: bl.contactName?.trim() || "WhatsApp lead",
          phone: bl.contactPhone,
          leadSourceId: whatsappSource?.id ?? null,
          sourceDetail: bl.path,
          ownerUserId: bl.assignedToUserId,
          status: mapBotLeadStatus(bl.status),
        },
      });
      await prisma.botLead.update({ where: { id: bl.id }, data: { leadId: lead.id } });
      leadsCreated++;
    } catch (err) {
      console.error(`  ERROR botLead ${bl.id}:`, err);
    }
  }

  console.log("=== CRM backfill complete ===");
  console.log({ dealsCreated, dealsReused, quotesLinked, designsLinked, lineItemsWritten, leadsCreated });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
