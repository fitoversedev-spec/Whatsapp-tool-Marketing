// Duplicate badges on a website lead. The same person is SHOWN, never merged: a
// website lead can carry "Already in CRM" (a live CRM contact has the number),
// "Also an ad lead" (a Meta ad lead has it) and "WhatsApp contact" (a WhatsApp
// marketing contact has it). Worked out when the lead is read, not stored, so
// they are always current. Each badge carries the id of the matching record so
// the page can link to it.
//
// Matching is on the last 10 digits (cheap in SQL), then confirmed by comparing
// the normalised numbers (src/lib/phone.ts) — the same rule as
// contactsMatchingPhone in src/lib/crm/contactLinks.ts.
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { contactsMatchingPhone } from "@/lib/crm/contactLinks";

export type LeadBadgeKind = "crm" | "ad_lead" | "whatsapp";
export type LeadBadge = {
  kind: LeadBadgeKind;
  label: string;
  id: string; // AccountContact.id (crm), MetaLead.id (ad_lead) or Contact.id (whatsapp)
};

export const BADGE_LABELS: Record<LeadBadgeKind, string> = {
  crm: "Already in CRM",
  ad_lead: "Also an ad lead",
  whatsapp: "WhatsApp contact",
};

export type BadgeLead = { id: string; phone: string | null; normalizedPhone: string | null };
type PhoneRow = { id: string; phone: string };

/** The last 10 digits of a phone number, or null when it has fewer than 10 digits. */
export function lastTenDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

const phoneOf = (l: BadgeLead) => l.normalizedPhone ?? l.phone;

// Meta ad leads and WhatsApp marketing contacts whose number ends in one of `tails`.
async function adLeadAndWhatsappRows(tails: string[]): Promise<{ ad: PhoneRow[]; wa: PhoneRow[] }> {
  const [ad, wa] = await Promise.all([
    prisma.$queryRaw<PhoneRow[]>`
      SELECT id, coalesce(normalized_phone, phone) AS phone FROM "meta_leads"
      WHERE coalesce(normalized_phone, phone) IS NOT NULL
        AND right(regexp_replace(coalesce(normalized_phone, phone), '\\D', '', 'g'), 10) = ANY(${tails})`,
    prisma.$queryRaw<PhoneRow[]>`
      SELECT id, phone_e164 AS phone FROM "contacts"
      WHERE right(regexp_replace(phone_e164, '\\D', '', 'g'), 10) = ANY(${tails})`,
  ]);
  return { ad, wa };
}

// Live CRM contacts whose number ends in one of `tails` (many leads at once).
function crmRowsFor(tails: string[]): Promise<PhoneRow[]> {
  return prisma.$queryRaw<PhoneRow[]>`
    SELECT id, phone FROM "account_contacts"
    WHERE deleted_at IS NULL AND phone IS NOT NULL
      AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ANY(${tails})`;
}

// First record per lead whose normalised number equals the lead's.
function firstMatch(rows: PhoneRow[], wanted: string): string | undefined {
  return rows.find((r) => normalizePhone(r.phone) === wanted)?.id;
}

function assemble(
  leads: BadgeLead[],
  crm: PhoneRow[],
  rows: { ad: PhoneRow[]; wa: PhoneRow[] },
): Map<string, LeadBadge[]> {
  const out = new Map<string, LeadBadge[]>();
  for (const lead of leads) {
    const phone = phoneOf(lead);
    const tail = lastTenDigits(phone);
    const wanted = phone ? normalizePhone(phone) : null;
    if (!tail || !wanted) continue;
    const near = (list: PhoneRow[]) => list.filter((r) => lastTenDigits(r.phone) === tail);
    const badges: LeadBadge[] = [];
    const crmId = firstMatch(near(crm), wanted);
    if (crmId) badges.push({ kind: "crm", label: BADGE_LABELS.crm, id: crmId });
    const adId = firstMatch(near(rows.ad), wanted);
    if (adId) badges.push({ kind: "ad_lead", label: BADGE_LABELS.ad_lead, id: adId });
    const waId = firstMatch(near(rows.wa), wanted);
    if (waId) badges.push({ kind: "whatsapp", label: BADGE_LABELS.whatsapp, id: waId });
    if (badges.length) out.set(lead.id, badges);
  }
  return out;
}

/** Badges for a page of leads: three queries in all, however many leads. Leads with none are absent from the map. */
export async function getBadgesForLeads(leads: BadgeLead[]): Promise<Map<string, LeadBadge[]>> {
  const tails = [...new Set(leads.map((l) => lastTenDigits(phoneOf(l))).filter((t): t is string => !!t))];
  if (tails.length === 0) return new Map();
  const [crm, rows] = await Promise.all([crmRowsFor(tails), adLeadAndWhatsappRows(tails)]);
  return assemble(leads, crm, rows);
}

/** Badges for one lead (the detail page). Uses contactsMatchingPhone for the CRM check. */
export async function getBadgesForLead(lead: BadgeLead): Promise<LeadBadge[]> {
  const phone = phoneOf(lead);
  const tail = lastTenDigits(phone);
  if (!phone || !tail) return [];
  const [crm, rows] = await Promise.all([contactsMatchingPhone(phone), adLeadAndWhatsappRows([tail])]);
  return assemble([lead], crm, rows).get(lead.id) ?? [];
}
