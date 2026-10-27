// Labels on CRM contacts (AccountContact). They come from the same shared catalogue
// as ad-lead and website-lead labels (MetaLeadLabel; list or create them with
// /api/ad-campaigns/labels), so a name and colour look the same everywhere.
// Access follows the contact itself: the customerAccess() rule the contact PATCH /
// DELETE routes use (reps reach their own customers, admins/managers all), and a
// soft-deleted contact is never touched.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { customerAccess } from "@/lib/rbac";

export const MAX_LABELS_PER_CONTACT = 20;
export const MAX_BULK_LABEL_CONTACTS = 300;

export type ContactLabel = { id: string; name: string; color: string };

type Actor = { id: string; role: string };

const live = { deletedAt: null } as const;

// ---- one contact -----------------------------------------------------------

export type SetLabelsResult =
  | { kind: "ok"; labels: ContactLabel[] }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid_label" };

/** Replace the contact's applied labels with `labelIds`; the result lists them by name. */
export async function setContactLabels(user: Actor, contactId: string, labelIds: string[]): Promise<SetLabelsResult> {
  const contact = await prisma.accountContact.findFirst({
    where: { id: contactId, ...live },
    select: { id: true, account: { select: { ownerUserId: true } } },
  });
  if (!contact) return { kind: "not_found" };
  if (!customerAccess(user, contact.account.ownerUserId).canEdit) return { kind: "forbidden" };

  const wanted = [...new Set(labelIds)];
  const found = wanted.length
    ? await prisma.metaLeadLabel.findMany({
        where: { id: { in: wanted } },
        select: { id: true, name: true, color: true },
      })
    : [];
  if (found.length !== wanted.length) return { kind: "invalid_label" };

  await prisma.$transaction(async (tx) => {
    await tx.accountContactToLabel.deleteMany({
      where: { accountContactId: contact.id, ...(wanted.length ? { labelId: { notIn: wanted } } : {}) },
    });
    if (wanted.length > 0) {
      await tx.accountContactToLabel.createMany({
        data: wanted.map((labelId) => ({ accountContactId: contact.id, labelId })),
        skipDuplicates: true,
      });
    }
  });
  return { kind: "ok", labels: found.sort((a, b) => a.name.localeCompare(b.name)) };
}

// ---- many contacts ---------------------------------------------------------

export type BulkLabelResult = { kind: "ok"; changed: number; skipped: number } | { kind: "invalid_label" };

/**
 * Add one label to (or take it off) many contacts. Only live contacts the user can
 * edit are touched: `changed` counts those (the label is on / off them now, whether
 * or not it already was), `skipped` counts every other id asked for (unknown,
 * deleted, or not theirs).
 */
export async function bulkChangeContactLabel(
  user: Actor,
  args: { ids: string[]; labelId: string; action: "add" | "remove" },
): Promise<BulkLabelResult> {
  const label = await prisma.metaLeadLabel.findUnique({ where: { id: args.labelId }, select: { id: true } });
  if (!label) return { kind: "invalid_label" };

  const ids = [...new Set(args.ids)];
  const contacts = await prisma.accountContact.findMany({
    where: { id: { in: ids }, ...live },
    select: { id: true, account: { select: { ownerUserId: true } } },
  });
  const allowed = contacts.filter((c) => customerAccess(user, c.account.ownerUserId).canEdit).map((c) => c.id);

  if (allowed.length > 0) {
    if (args.action === "add") {
      await prisma.accountContactToLabel.createMany({
        data: allowed.map((accountContactId) => ({ accountContactId, labelId: label.id })),
        skipDuplicates: true,
      });
    } else {
      await prisma.accountContactToLabel.deleteMany({
        where: { accountContactId: { in: allowed }, labelId: label.id },
      });
    }
  }
  return { kind: "ok", changed: allowed.length, skipped: ids.length - allowed.length };
}

// ---- Move to CRM / merge: one-way unions -----------------------------------

/**
 * Move to CRM: copy the lead's labels onto its CRM contact, once. Union only (the
 * contact keeps whatever it already has) and no later sync. Does nothing when the
 * lead has no labels or the contact has been deleted. Pass the transaction when
 * the caller has one.
 */
export async function copyLeadLabelsToContact(
  db: Prisma.TransactionClient,
  source: { metaLeadId: string } | { websiteLeadId: string },
  accountContactId: string,
): Promise<void> {
  const rows =
    "metaLeadId" in source
      ? await db.metaLeadToLabel.findMany({ where: { metaLeadId: source.metaLeadId }, select: { labelId: true } })
      : await db.websiteLeadToLabel.findMany({ where: { websiteLeadId: source.websiteLeadId }, select: { labelId: true } });
  if (rows.length === 0) return;
  if (!(await db.accountContact.findFirst({ where: { id: accountContactId, ...live }, select: { id: true } }))) return;
  await db.accountContactToLabel.createMany({
    data: rows.map((r) => ({ accountContactId, labelId: r.labelId })),
    skipDuplicates: true,
  });
}

/** Merge: give the surviving contact every label the merged-away ones had (union only). */
export async function mergeContactLabels(db: Prisma.TransactionClient, fromIds: string[], toId: string): Promise<void> {
  const rows = await db.accountContactToLabel.findMany({
    where: { accountContactId: { in: fromIds } },
    select: { labelId: true },
  });
  const labelIds = [...new Set(rows.map((r) => r.labelId))];
  if (labelIds.length === 0) return;
  await db.accountContactToLabel.createMany({
    data: labelIds.map((labelId) => ({ accountContactId: toId, labelId })),
    skipDuplicates: true,
  });
}
