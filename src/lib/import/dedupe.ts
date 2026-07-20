// Per-target validation + dedupe-detection + commit logic for the guided
// import wizard. Duplicate action ("skip" | "update" | "create") is a
// single choice for the whole batch, not per-row — matches the spec's own
// wording ("offer skip / update-existing / create-new per the batch").
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { findAccountDuplicate, findAccountContactDuplicate, type AccountContactDuplicateCandidate } from "@/lib/crm/accounts";
import { defaultFunnelStageId } from "@/lib/crm/deals";
import type { ImportTarget } from "./mapping";

export type DedupeAction = "skip" | "update" | "create";

export function extractFieldValues(
  headers: string[],
  row: unknown[],
  columnMap: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [fieldKey, headerName] of Object.entries(columnMap)) {
    if (!headerName) continue;
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === headerName.trim().toLowerCase());
    values[fieldKey] = idx >= 0 ? String(row[idx] ?? "").trim() : "";
  }
  return values;
}

// Perf: validateRow()/commitRow() run once per uploaded row (up to 2000 —
// both /api/import/preview and /api/import/commit loop over every row). The
// CONTACTS/LEADS phone-dedupe checks used to re-run an unbounded
// findMany-the-whole-table query on every single row (measured: a 5-row
// preview issued 5 full-table account_contacts/leads fetches — see
// docs/DECISIONS.md perf note). DedupeContext pre-fetches that lookup ONCE
// per import call and is threaded through so it's O(1) per row instead.
// Rows created mid-commit are added to the maps in commitRow() below so
// intra-batch duplicates (same phone twice in one file) are still caught,
// matching the original re-fetch-every-time behavior.
export type DedupeContext = {
  contactPhoneIndex?: Map<string, AccountContactDuplicateCandidate>;
  leadPhoneIndex?: Map<string, { id: string; name: string; phone: string }>;
};

export async function buildDedupeContext(target: ImportTarget): Promise<DedupeContext> {
  if (target === "CONTACTS") {
    const rows = await prisma.accountContact.findMany({
      where: { phone: { not: null } },
      select: { id: true, name: true, phone: true, accountId: true },
    });
    const contactPhoneIndex = new Map<string, AccountContactDuplicateCandidate>();
    for (const r of rows) {
      const canonical = r.phone ? normalizePhone(r.phone) : null;
      if (canonical && !contactPhoneIndex.has(canonical)) contactPhoneIndex.set(canonical, r);
    }
    return { contactPhoneIndex };
  }
  if (target === "LEADS") {
    const rows = await prisma.lead.findMany({ select: { id: true, name: true, phone: true } });
    const leadPhoneIndex = new Map<string, { id: string; name: string; phone: string }>();
    for (const r of rows) {
      const canonical = normalizePhone(r.phone);
      if (canonical && !leadPhoneIndex.has(canonical)) leadPhoneIndex.set(canonical, r);
    }
    return { leadPhoneIndex };
  }
  return {};
}

export async function validateRow(
  target: ImportTarget,
  fields: Record<string, string>,
  context?: DedupeContext,
): Promise<{ errors: string[]; duplicateId?: string; duplicateLabel?: string }> {
  if (target === "COMPANIES") {
    const errors: string[] = [];
    if (!fields.name) errors.push("Company name is required");
    if (errors.length) return { errors };
    const dup = await findAccountDuplicate({ name: fields.name, city: fields.city || undefined, gstin: fields.gstin || undefined });
    return { errors, duplicateId: dup?.id, duplicateLabel: dup?.name };
  }

  if (target === "CONTACTS") {
    const errors: string[] = [];
    if (!fields.accountName) errors.push("Company name is required");
    if (!fields.name) errors.push("Contact name is required");
    if (errors.length) return { errors };
    const account = await prisma.account.findFirst({
      where: { name: { equals: fields.accountName, mode: "insensitive" }, deletedAt: null },
      select: { id: true },
    });
    const dup = await findAccountContactDuplicate(
      { phone: fields.phone || undefined, name: fields.name, accountId: account?.id },
      context?.contactPhoneIndex,
    );
    return { errors, duplicateId: dup?.id, duplicateLabel: dup?.name };
  }

  if (target === "LEADS") {
    const errors: string[] = [];
    if (!fields.name) errors.push("Name is required");
    if (!fields.phone) errors.push("Phone is required");
    else if (!normalizePhone(fields.phone)) errors.push("Phone is not a valid number");
    if (errors.length) return { errors };
    const normalized = normalizePhone(fields.phone)!;
    let dup: { id: string; name: string; phone: string } | undefined;
    if (context?.leadPhoneIndex) {
      dup = context.leadPhoneIndex.get(normalized);
    } else {
      const existing = await prisma.lead.findMany({ select: { id: true, name: true, phone: true } });
      dup = existing.find((l) => normalizePhone(l.phone) === normalized);
    }
    return { errors, duplicateId: dup?.id, duplicateLabel: dup?.name };
  }

  // DEALS — each row is a new opportunity by nature; no dedupe check, only
  // validation. estimatedValue is optional but must parse if present.
  const errors: string[] = [];
  if (!fields.title) errors.push("Deal title is required");
  if (!fields.accountName) errors.push("Company name is required");
  if (fields.estimatedValue && Number.isNaN(Number(fields.estimatedValue))) errors.push("Estimated value must be a number");
  return { errors };
}

// Finds an Account by exact name, or creates one — shared by the CONTACTS
// and DEALS importers, both of which reference a company by name only.
// classification (customer type / business type) is applied even to an
// EXISTING account when given, same "a later value wins" rule
// findOrCreateDealForConversation's own resolveAccountId uses — a later,
// more-informed import row isn't silently ignored.
async function resolveAccountByName(
  name: string,
  city: string | undefined,
  userId: string,
  classification?: { customerProfileId?: string; businessType?: string },
): Promise<string> {
  const existing = await prisma.account.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, deletedAt: null },
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
  const created = await prisma.account.create({
    data: {
      name,
      city: city || null,
      customerProfileId: classification?.customerProfileId ?? null,
      businessType: classification?.businessType ?? null,
      ownerUserId: userId,
    },
  });
  return created.id;
}

// Writes one row. Returns the created/updated row's id, or null if the
// row was skipped (duplicate + action:"skip"). Only rows that CREATE a
// new record are stamped with importBatchId — updated rows keep whatever
// batch (or none) originally created them, so undo never touches them.
export async function commitRow(
  target: ImportTarget,
  fields: Record<string, string>,
  duplicateId: string | undefined,
  action: DedupeAction,
  userId: string,
  importBatchId: string,
  context?: DedupeContext,
): Promise<{ id: string; created: boolean } | null> {
  if (duplicateId && action === "skip") return null;

  if (target === "COMPANIES") {
    if (duplicateId && action === "update") {
      const updated = await prisma.account.update({
        where: { id: duplicateId },
        data: {
          city: fields.city || undefined,
          businessType: (fields.businessType as "B2B" | "B2C" | "B2G") || undefined,
          gstin: fields.gstin || undefined,
          notes: fields.notes || undefined,
        },
      });
      return { id: updated.id, created: false };
    }
    const created = await prisma.account.create({
      data: {
        name: fields.name,
        city: fields.city || null,
        businessType: (fields.businessType as "B2B" | "B2C" | "B2G") || null,
        gstin: fields.gstin || null,
        notes: fields.notes || null,
        ownerUserId: userId,
        importBatchId,
      },
    });
    return { id: created.id, created: true };
  }

  if (target === "CONTACTS") {
    // Mirrors the New Contact form's own field set: Location/Customer type/
    // Business type land on the (possibly-reused) Account, same as the
    // manual flow's inline account creation; Lead source has no dedicated
    // column on AccountContact (only Deal does, and a Contacts-import batch
    // deliberately never creates Deals — stays single-target, matching the
    // wizard's existing rule) so it's composed into notes instead, same
    // fallback the manual form already uses for its own "source detail" field.
    const customerProfile = fields.customerProfileName
      ? await prisma.customerProfile.findFirst({
          where: { name: { equals: fields.customerProfileName, mode: "insensitive" } },
          select: { id: true },
        })
      : null;
    const businessType =
      fields.businessType && ["B2B", "B2C", "B2G"].includes(fields.businessType.trim().toUpperCase())
        ? fields.businessType.trim().toUpperCase()
        : undefined;
    const accountId = await resolveAccountByName(fields.accountName, fields.siteCity, userId, {
      customerProfileId: customerProfile?.id,
      businessType,
    });
    const composedNotes =
      [
        fields.customerProfileName && !customerProfile ? `Customer type (unmatched): ${fields.customerProfileName.trim()}` : "",
        fields.leadSourceName ? `Lead source: ${fields.leadSourceName.trim()}` : "",
        fields.sourceDetail ? `Source detail: ${fields.sourceDetail.trim()}` : "",
        fields.notes?.trim() || "",
      ]
        .filter(Boolean)
        .join("\n\n") || null;

    if (duplicateId && action === "update") {
      const updated = await prisma.accountContact.update({
        where: { id: duplicateId },
        data: {
          phone: fields.phone || undefined,
          email: fields.email || undefined,
          designation: fields.designation || undefined,
          notes: composedNotes ?? undefined,
        },
      });
      // Keep the index current if this row's phone changed mid-batch too
      // (not just on create) — same intra-batch-dedupe reasoning as above.
      if (context?.contactPhoneIndex && updated.phone) {
        const canonical = normalizePhone(updated.phone);
        if (canonical) context.contactPhoneIndex.set(canonical, { id: updated.id, name: updated.name, phone: updated.phone, accountId: updated.accountId });
      }
      return { id: updated.id, created: false };
    }
    const created = await prisma.accountContact.create({
      data: {
        accountId,
        name: fields.name,
        phone: fields.phone || null,
        email: fields.email || null,
        designation: fields.designation || null,
        notes: composedNotes,
        importBatchId,
      },
    });
    // Register the new row in the shared dedupe index (if the caller passed
    // one — see buildDedupeContext) so a later row in the SAME import batch
    // with the same phone number still gets caught as a duplicate, matching
    // what the old per-row re-fetch did for free.
    if (context?.contactPhoneIndex && created.phone) {
      const canonical = normalizePhone(created.phone);
      if (canonical) context.contactPhoneIndex.set(canonical, { id: created.id, name: created.name, phone: created.phone, accountId: created.accountId });
    }
    return { id: created.id, created: true };
  }

  if (target === "LEADS") {
    const leadSource = fields.leadSourceName
      ? await prisma.leadSource.findFirst({ where: { name: { equals: fields.leadSourceName, mode: "insensitive" } }, select: { id: true } })
      : null;
    if (duplicateId && action === "update") {
      const updated = await prisma.lead.update({
        where: { id: duplicateId },
        data: {
          email: fields.email || undefined,
          city: fields.city || undefined,
          leadSourceId: leadSource?.id,
        },
      });
      return { id: updated.id, created: false };
    }
    const created = await prisma.lead.create({
      data: {
        name: fields.name,
        phone: normalizePhone(fields.phone) ?? fields.phone,
        email: fields.email || null,
        city: fields.city || null,
        leadSourceId: leadSource?.id ?? null,
        rawEnquiryText: fields.interestNote || null,
        ownerUserId: userId,
        importBatchId,
      },
    });
    // Same intra-batch dedupe note as the CONTACTS branch above.
    if (context?.leadPhoneIndex) {
      const canonical = normalizePhone(created.phone);
      if (canonical) context.leadPhoneIndex.set(canonical, { id: created.id, name: created.name, phone: created.phone });
    }
    return { id: created.id, created: true };
  }

  // DEALS — always creates (no dedupe path)
  const accountId = await resolveAccountByName(fields.accountName, fields.siteCity, userId);
  const leadSource = fields.leadSourceName
    ? await prisma.leadSource.findFirst({ where: { name: { equals: fields.leadSourceName, mode: "insensitive" } }, select: { id: true } })
    : null;
  const stageId = await defaultFunnelStageId();
  const year = new Date().getFullYear();
  const seq = (await prisma.deal.count({ where: { code: { startsWith: `FIT-DL-${year}-` } } })) + 1;
  const created = await prisma.deal.create({
    data: {
      code: `FIT-DL-${year}-${String(seq).padStart(3, "0")}`,
      title: fields.title,
      accountId,
      ownerUserId: userId,
      currentStageId: stageId,
      siteCity: fields.siteCity || undefined,
      estimatedValue: fields.estimatedValue ? Number(fields.estimatedValue) : null,
      leadSourceId: leadSource?.id ?? null,
      importBatchId,
      dealChannel: "crm",
    },
  });
  return { id: created.id, created: true };
}
