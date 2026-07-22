// Duplicate-check + merge helpers for Account ("Company") and
// AccountContact ("Contact") — the two CRM person/company objects that
// have never had a dedicated CRUD surface until this build. Mirrors the
// existing marketing-Contact pattern (src/app/api/contacts/{duplicates,
// merge}/route.ts) adapted to these two models.
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";

export type AccountDuplicateCandidate = { id: string; name: string; city: string | null };

// Exact case-insensitive name(+city) match — same rule already live on the
// inline-account path in POST /api/deals — plus a new GSTIN exact-match
// arm (the field exists on Account but nothing has ever read it).
export async function findAccountDuplicate(input: {
  name: string;
  city?: string | null;
  gstin?: string | null;
}): Promise<AccountDuplicateCandidate | null> {
  if (input.gstin) {
    const byGstin = await prisma.account.findFirst({
      where: { deletedAt: null, gstin: input.gstin },
      select: { id: true, name: true, city: true },
    });
    if (byGstin) return byGstin;
  }
  return prisma.account.findFirst({
    where: {
      deletedAt: null,
      name: { equals: input.name, mode: "insensitive" },
      ...(input.city ? { city: { equals: input.city, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, city: true },
  });
}

// Re-points every Deal/AccountContact/Activity from the secondaries onto
// the primary, then deletes the secondaries. Irreversible — the API route
// calling this is admin-only and the UI must show a confirm step (matches
// the existing Contact merge's own caution).
export async function mergeAccounts(primaryId: string, secondaryIds: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.deal.updateMany({ where: { accountId: { in: secondaryIds } }, data: { accountId: primaryId } });
    await tx.accountContact.updateMany({ where: { accountId: { in: secondaryIds } }, data: { accountId: primaryId } });
    await tx.activity.updateMany({ where: { accountId: { in: secondaryIds } }, data: { accountId: primaryId } });
    await tx.account.deleteMany({ where: { id: { in: secondaryIds } } });
  });
}

export type AccountContactDuplicateCandidate = {
  id: string;
  name: string;
  phone: string | null;
  accountId: string;
};

// Phone-exact (normalized to E.164 via the same normalizePhone() the rest
// of the app uses for WhatsApp sends — critically, this also equates
// "9876543210" with "+91 98765 43210", which a naive digits-only strip
// would treat as two different numbers) plus a name+company fallback
// within the same Account — full fuzzy string-distance matching is future
// scope, not needed for v1.
//
// phoneIndex is an optional pre-built (normalized phone -> candidate) map.
// Single-row callers (the New Contact form) omit it and get the original
// one-off findMany. The bulk import wizard (src/lib/import/dedupe.ts) calls
// this once per uploaded row — up to 2000 times per import — so it builds
// the index ONCE up front and passes it in, turning what was an unbounded
// full-table findMany on every single row into one fetch for the whole
// batch. See docs/DECISIONS.md perf note added alongside this.
export async function findAccountContactDuplicate(
  input: {
    phone?: string | null;
    name: string;
    accountId?: string | null;
  },
  phoneIndex?: Map<string, AccountContactDuplicateCandidate>,
): Promise<AccountContactDuplicateCandidate | null> {
  if (input.phone) {
    const canonical = normalizePhone(input.phone);
    if (canonical) {
      if (phoneIndex) {
        const byPhone = phoneIndex.get(canonical);
        if (byPhone) return byPhone;
      } else {
        const withPhones = await prisma.accountContact.findMany({
          where: { phone: { not: null }, deletedAt: null },
          select: { id: true, name: true, phone: true, accountId: true },
        });
        const byPhone = withPhones.find((c) => c.phone && normalizePhone(c.phone) === canonical);
        if (byPhone) return byPhone;
      }
    }
  }
  if (input.accountId) {
    const byNameInCompany = await prisma.accountContact.findFirst({
      where: { accountId: input.accountId, name: { equals: input.name, mode: "insensitive" }, deletedAt: null },
      select: { id: true, name: true, phone: true, accountId: true },
    });
    if (byNameInCompany) return byNameInCompany;
  }
  return null;
}

export async function mergeAccountContacts(primaryId: string, secondaryIds: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.deal.updateMany({
      where: { primaryContactId: { in: secondaryIds } },
      data: { primaryContactId: primaryId },
    });
    await tx.activity.updateMany({
      where: { accountContactId: { in: secondaryIds } },
      data: { accountContactId: primaryId },
    });
    await tx.accountContact.deleteMany({ where: { id: { in: secondaryIds } } });
  });
}
