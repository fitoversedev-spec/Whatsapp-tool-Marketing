// Deal code generation — mirrors buildQuotationNumber/nextSequenceForYear in
// src/app/api/quotations/route.ts exactly (max-existing-seq + 1, not
// count()+1, so a deleted row never causes a collision; retry-on-P2002 at
// the call site handles the genuine-race case).
import { prisma } from "@/lib/prisma";

export function buildDealCode(year: number, existingThisYear: number): string {
  const seq = String(existingThisYear + 1).padStart(3, "0");
  return `FIT-DL-${year}-${seq}`;
}

export async function nextDealSequenceForYear(year: number): Promise<number> {
  const prefix = `FIT-DL-${year}-`;
  const latest = await prisma.deal.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  if (!latest) return 1;
  const seqStr = latest.code.slice(prefix.length);
  const seq = parseInt(seqStr, 10);
  if (!Number.isFinite(seq)) return 1;
  return seq + 1;
}

// The stage a brand-new Deal starts in — lowest sortOrder among active
// (non-won/lost) stages. Throws if none exist (shouldn't happen once
// scripts/seed-taxonomies.ts has run).
export async function defaultFunnelStageId(): Promise<string> {
  const stage = await prisma.funnelStage.findFirst({
    where: { isActive: true, stageType: "active" },
    orderBy: { sortOrder: "asc" },
  });
  if (!stage) throw new Error("No active FunnelStage rows — run scripts/seed-taxonomies.ts");
  return stage.id;
}

type AccountClassification = { customerProfileId?: string | null; businessType?: string | null };

// Account de-dup: exact case-insensitive name match — same rule the live
// "possible duplicate" prompt in POST /api/deals uses, and the same
// documented limitation (scripts/backfill-crm.ts, docs/DECISIONS.md): a
// best-effort reconstruction, not verified lineage. Used here because this
// path is a background convenience (a quote/design/reminder being saved),
// not a user-facing "create account" action — no duplicate-prompt UI exists
// to show.
//
// classification (customer profile / business type) is applied even to an
// EXISTING account when given — same "a later correction wins" rule as
// Deal.siteCity, rather than only-fill-if-empty, so re-classifying a
// customer on a later quote isn't silently ignored.
async function resolveAccountId(
  name: string,
  ownerUserId: string,
  phone: string | null,
  classification?: AccountClassification,
): Promise<string> {
  const trimmed = name.trim() || "Unknown customer";
  const existing = await prisma.account.findFirst({
    where: { deletedAt: null, name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    if (classification?.customerProfileId || classification?.businessType) {
      await prisma.account
        .update({
          where: { id: existing.id },
          data: {
            ...(classification.customerProfileId ? { customerProfileId: classification.customerProfileId } : {}),
            ...(classification.businessType ? { businessType: classification.businessType } : {}),
          },
        })
        .catch(() => null);
    }
    return existing.id;
  }
  const account = await prisma.account.create({
    data: {
      name: trimmed,
      ownerUserId,
      customerProfileId: classification?.customerProfileId ?? null,
      businessType: classification?.businessType ?? null,
    },
  });
  if (phone) {
    await prisma.accountContact.create({ data: { accountId: account.id, name: trimmed, phone, isPrimary: true } });
  }
  return account.id;
}

// The single chokepoint for "this feature touches a conversation and needs
// a Deal to attach to." Reuses an existing Deal for the conversation if one
// exists (so quotes/designs/reminders/pipeline-moves on the SAME
// conversation converge on one Deal instead of each spawning their own —
// the fragmentation bug documented in docs/DECISIONS.md's Phase 6+ entry),
// otherwise creates one.
//
// conversationId is nullable: a genuinely standalone action (a walk-in
// quote with no conversation behind it) has nothing to key reuse off, so it
// always creates a fresh Deal with conversationId left null — Deal.conversationId
// is a real FK to Conversation, so this must never be filled with a
// non-existent id.
//
// accountName and dealTitle are separate on purpose: a conversation's own
// contactName (when present) always wins for the account, but the deal's
// title is caller-specific (a quote knows the sport, a reminder doesn't).
//
// leadSourceId/customerProfileId/businessType are optional classification —
// Tier-1 analytics inputs (source/customer-profile breakdowns in Team
// Performance were previously always empty since nothing ever set them, see
// docs/DECISIONS.md). leadSourceId is set on the Deal itself; the other two
// go through resolveAccountId onto the Account, applying even to a REUSED
// deal/account (a later, more-informed quote can correct an earlier guess).
export async function findOrCreateDealForConversation(args: {
  conversationId: string | null;
  accountName: string;
  dealTitle: string;
  ownerUserId: string;
  leadSourceId?: string | null;
  customerProfileId?: string | null;
  businessType?: string | null;
}): Promise<{ id: string; isNew: boolean }> {
  if (args.conversationId) {
    const existing = await prisma.deal.findFirst({ where: { conversationId: args.conversationId }, select: { id: true } });
    if (existing) {
      if (args.leadSourceId || args.customerProfileId || args.businessType) {
        if (args.leadSourceId) {
          await prisma.deal.update({ where: { id: existing.id }, data: { leadSourceId: args.leadSourceId } }).catch(() => null);
        }
        if (args.customerProfileId || args.businessType) {
          const dealAccount = await prisma.deal.findUnique({ where: { id: existing.id }, select: { accountId: true } });
          if (dealAccount) {
            await prisma.account
              .update({
                where: { id: dealAccount.accountId },
                data: {
                  ...(args.customerProfileId ? { customerProfileId: args.customerProfileId } : {}),
                  ...(args.businessType ? { businessType: args.businessType } : {}),
                },
              })
              .catch(() => null);
          }
        }
      }
      return { id: existing.id, isNew: false };
    }
  }

  const convo = args.conversationId
    ? await prisma.conversation.findUnique({
        where: { id: args.conversationId },
        select: { contactName: true, contactPhone: true },
      })
    : null;
  const accountName = convo?.contactName?.trim() || args.accountName;
  const accountId = await resolveAccountId(accountName, args.ownerUserId, convo?.contactPhone ?? null, {
    customerProfileId: args.customerProfileId,
    businessType: args.businessType,
  });

  const year = new Date().getFullYear();
  const stageId = await defaultFunnelStageId();

  let deal;
  let lastError: unknown = null;
  let nextSeq = await nextDealSequenceForYear(year);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      deal = await prisma.deal.create({
        data: {
          code: buildDealCode(year, nextSeq - 1),
          title: args.dealTitle,
          accountId,
          ownerUserId: args.ownerUserId,
          currentStageId: stageId,
          conversationId: args.conversationId,
          leadSourceId: args.leadSourceId ?? null,
        },
      });
      break;
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      nextSeq += 1;
    }
  }
  if (!deal) throw lastError ?? new Error("Could not create Deal after retries");
  return { id: deal.id, isNew: true };
}
