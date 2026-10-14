// Small contact writes shared by the human CRM routes and the AI Sales Agent
// API, so both create exactly the same rows: a new lead (company + person), a
// note, product interest, and a logged activity.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient;

// ── new customer ────────────────────────────────────────────────────────────

export function createAccountForContact(
  args: {
    name: string;
    city?: string | null;
    customerProfileId?: string | null;
    businessType?: string | null;
    ownerUserId: string | null;
  },
  db: Db | typeof prisma = prisma,
) {
  return db.account.create({
    data: {
      name: args.name,
      city: args.city ?? null,
      customerProfileId: args.customerProfileId ?? null,
      businessType: args.businessType ?? null,
      ownerUserId: args.ownerUserId,
    },
  });
}

export type NewContactArgs = {
  accountId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  designation?: string | null;
  notes?: string | null;
  fields?: Record<string, string>;
  isPrimary?: boolean;
  leadSourceId?: string | null;
  createdByUserId: string;
  // The contact's sales stage (a quick-added lead starts at the first stage).
  leadStageId?: string | null;
  // Stamp the contact as a promoted LEAD so it shows in the CRM Leads list.
  asLead?: boolean;
};

// Creates the person under a company. With `tx` it joins the caller's
// transaction (so a company and its first contact are all-or-nothing);
// without it, it runs in its own.
export async function createContactInAccount(args: NewContactArgs, tx?: Db) {
  const run = async (db: Db) => {
    if (args.isPrimary) {
      await db.accountContact.updateMany({ where: { accountId: args.accountId }, data: { isPrimary: false } });
    }
    const contact = await db.accountContact.create({
      data: {
        accountId: args.accountId,
        name: args.name,
        phone: args.phone ?? null,
        email: args.email ?? null,
        designation: args.designation ?? null,
        notes: args.notes ?? null,
        fields: JSON.stringify(args.fields ?? {}),
        isPrimary: args.isPrimary ?? false,
        leadSourceId: args.leadSourceId ?? null,
        createdByUserId: args.createdByUserId,
        leadStageId: args.leadStageId ?? null,
        ...(args.asLead ? { pipelineStage: "LEAD", promotedToLeadAt: new Date() } : {}),
      },
    });
    return { contact };
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

// ── notes ───────────────────────────────────────────────────────────────────

export function createContactNote(args: { contactId: string; authorUserId: string; title?: string | null; body: string }) {
  return prisma.accountContactNote.create({
    data: {
      accountContactId: args.contactId,
      authorUserId: args.authorUserId,
      title: args.title?.trim() || null,
      body: args.body.trim(),
    },
    include: { author: { select: { name: true } } },
  });
}

// ── product interest ────────────────────────────────────────────────────────

export class UnknownProductError extends Error {
  constructor() {
    super("One of those products no longer exists");
  }
}

// Catalogue products and/or one free-text "Other", each recorded once.
// Returns how many rows were added; throws UnknownProductError for a product
// id that isn't in the catalogue.
export async function addProductInterests(args: {
  contactId: string;
  productIds: string[];
  otherLabel?: string | null;
  createdByUserId: string;
}): Promise<{ added: number }> {
  // Only real catalogue products, each once.
  const requested = Array.from(new Set(args.productIds));
  const known = requested.length
    ? await prisma.product.findMany({ where: { id: { in: requested } }, select: { id: true } })
    : [];
  if (known.length !== requested.length) throw new UnknownProductError();

  // Skip what's already recorded for this contact (products, or the same "Other" text).
  const label = args.otherLabel || null;
  const existing = await prisma.contactProductInterest.findMany({
    where: {
      accountContactId: args.contactId,
      OR: [{ productId: { in: requested } }, ...(label ? [{ productId: null, label: { equals: label, mode: "insensitive" as const } }] : [])],
    },
    select: { productId: true, label: true },
  });
  const have = new Set(existing.map((e) => e.productId).filter(Boolean));
  const labelKnown = existing.some((e) => !e.productId);
  const rows = [
    ...requested.filter((id) => !have.has(id)).map((productId) => ({ accountContactId: args.contactId, productId, createdByUserId: args.createdByUserId })),
    ...(label && !labelKnown ? [{ accountContactId: args.contactId, label, createdByUserId: args.createdByUserId }] : []),
  ];
  if (rows.length) await prisma.contactProductInterest.createMany({ data: rows });
  return { added: rows.length };
}

// ── activities ──────────────────────────────────────────────────────────────

// Logs an activity anchored on a contact. A deal is attached only if it really
// belongs to the same company.
export async function createContactActivity(args: {
  contact: { id: string; accountId: string };
  dealId?: string | null;
  activityTypeId: string;
  ownerUserId: string;
  subject: string;
  notes?: string | null;
  durationMins?: number | null;
  outcome?: string | null;
}) {
  let dealId: string | null = null;
  if (args.dealId) {
    const deal = await prisma.deal.findUnique({ where: { id: args.dealId }, select: { accountId: true } });
    if (deal && deal.accountId === args.contact.accountId) dealId = args.dealId;
  }

  return prisma.activity.create({
    data: {
      accountContactId: args.contact.id,
      accountId: args.contact.accountId,
      dealId,
      activityTypeId: args.activityTypeId,
      ownerUserId: args.ownerUserId,
      subject: args.subject,
      notes: args.notes ?? null,
      occurredAt: new Date(),
      durationMins: args.durationMins ?? null,
      outcome: args.outcome ?? null,
    },
  });
}
