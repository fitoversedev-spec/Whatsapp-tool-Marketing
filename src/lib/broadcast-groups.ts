// Broadcast groups — named, shared lists of WhatsApp marketing contacts that a
// broadcast can be sent to (see the BroadcastGroup model). People get in from
// the Ad campaigns lead lists: tick leads → Add to group. A broadcast stores the
// group id and reads the members when it sends, so later additions are included.
import { prisma } from "./prisma";
import { normalizePhone } from "./phone";

export const GROUP_NAME_MAX = 80;
// Upper bound for one add/assign request — comfortably above the largest lead
// list (every campaign's leads on the Ad campaigns page).
export const MAX_LEADS_PER_REQUEST = 5000;

/** Who may rename or delete a group, or remove its members: its maker or an admin. */
export function canEditGroup(user: { id: string; role: string }, group: { createdByUserId: string }): boolean {
  return user.role === "admin" || group.createdByUserId === user.id;
}

/** Trim and collapse inner spaces so "  Football   leads " and "Football leads" match. */
export function tidyGroupName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** A group with this name, ignoring case ("football leads" = "Football Leads"). */
export async function findGroupByName(name: string, excludeId?: string) {
  return prisma.broadcastGroup.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

export type AddLeadsResult = {
  added: number; // newly in the group
  alreadyIn: number; // were members already
  noPhone: number; // leads skipped for having no usable phone number
};

/**
 * Put Meta ad leads into a group. Each lead's phone becomes (or matches) a
 * WhatsApp marketing contact — the same E.164 key and defaults as the lead
 * list's "→ WhatsApp" button — and that contact joins the group.
 *
 * Existing contacts are never overwritten: only a missing name or city
 * ("Attribute 1", the key imported contacts keep city in) is filled, and
 * allowCampaign is never touched, so a blocked contact stays blocked. Two leads
 * with the same phone are one contact.
 */
export async function addMetaLeadsToGroup(
  groupId: string,
  metaLeadIds: string[],
  userId: string,
): Promise<AddLeadsResult> {
  const leads = await prisma.metaLead.findMany({
    where: { id: { in: metaLeadIds } },
    select: { fullName: true, phone: true, normalizedPhone: true, city: true },
  });

  const byPhone = new Map<string, { name: string | null; city: string | null }>();
  let noPhone = 0;
  for (const l of leads) {
    const phone = (l.phone ? normalizePhone(l.phone) : null) ?? l.normalizedPhone ?? null;
    if (!phone) {
      noPhone++;
      continue;
    }
    const name = l.fullName?.trim() || null;
    const city = l.city?.trim() || null;
    const cur = byPhone.get(phone);
    byPhone.set(phone, cur ? { name: cur.name ?? name, city: cur.city ?? city } : { name, city });
  }

  const phones = [...byPhone.keys()];
  if (phones.length === 0) return { added: 0, alreadyIn: 0, noPhone };

  const existing = await prisma.contact.findMany({
    where: { phone: { in: phones } },
    select: { id: true, phone: true, name: true, fields: true },
  });
  const known = new Set(existing.map((c) => c.phone));

  const fresh = phones.filter((p) => !known.has(p));
  if (fresh.length > 0) {
    await prisma.contact.createMany({
      data: fresh.map((phone) => {
        const v = byPhone.get(phone)!;
        return {
          phone,
          name: v.name,
          allowCampaign: true,
          fields: JSON.stringify(v.city ? { "Attribute 1": v.city } : {}),
        };
      }),
      skipDuplicates: true,
    });
  }

  // Fill blanks on contacts that already existed — never replace a value.
  for (const c of existing) {
    const v = byPhone.get(c.phone)!;
    const data: { name?: string; fields?: string } = {};
    if (!c.name?.trim() && v.name) data.name = v.name;
    if (v.city) {
      let fields: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(c.fields);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
      } catch {
        /* unreadable fields — leave them alone */
      }
      if (fields && !String(fields["Attribute 1"] ?? "").trim()) {
        data.fields = JSON.stringify({ ...fields, "Attribute 1": v.city });
      }
    }
    if (data.name || data.fields) await prisma.contact.update({ where: { id: c.id }, data });
  }

  const contacts = await prisma.contact.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const created = await prisma.broadcastGroupMember.createMany({
    data: contacts.map((c) => ({ groupId, contactId: c.id, addedByUserId: userId })),
    skipDuplicates: true,
  });
  if (created.count > 0) {
    await prisma.broadcastGroup.update({ where: { id: groupId }, data: { updatedAt: new Date() } });
  }
  return { added: created.count, alreadyIn: contacts.length - created.count, noPhone };
}
