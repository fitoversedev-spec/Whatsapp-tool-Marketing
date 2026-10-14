import type { Prisma } from "@prisma/client";
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { findAccountContactDuplicate, findAccountDuplicate, type AccountContactDuplicateCandidate } from "@/lib/crm/accounts";
import { contactsMatchingPhone } from "@/lib/crm/contactLinks";
import { getContactTimeline } from "@/lib/crm/timeline";
import type { TimelineEntry } from "@/lib/crm/timelineShared";
import { AgentHttpError } from "../errors";
import {
  isUuid,
  type DuplicateCheckInput,
  type DuplicateMatch,
  type LeadRow,
  type SearchLeadsInput,
  type leadDetailSchema,
  type timelineItemSchema,
} from "../schemas/read";
import { digitsOnly, escapeLike, looksLikePhone, pageByOffset, parseStringMap, phoneLast4, requireId, toIso, toNumber } from "./shared";

/**
 * Leads / customers (AccountContact) for the agent's read tools. The agent sees
 * the whole company's customers, like a manager, but only the fields a sales
 * assistant needs: never private rep insights, attachments or their storage
 * URLs, internal cost, or anything about how the reps are performing.
 */

// ---- search_leads / get_pipeline rows --------------------------------------

export type LeadRowSource = {
  id: string;
  name: string;
  phone: string | null;
  pipelineStage: string | null;
  createdAt: Date;
  leadStage: { id: string; name: string } | null;
  leadSource: { name: string } | null;
  account: { name: string; city: string | null; owner: { id: string; name: string } | null };
};

export function toLeadRow(c: LeadRowSource, lastActivityAt: Date | null): LeadRow {
  return {
    id: c.id,
    name: c.name.trim(),
    company: c.account.name.trim(),
    city: c.account.city,
    phoneLast4: phoneLast4(c.phone),
    isLead: c.pipelineStage === "LEAD",
    stage: c.leadStage ? { id: c.leadStage.id, name: c.leadStage.name } : null,
    source: c.leadSource?.name ?? null,
    rep: c.account.owner ? { id: c.account.owner.id, name: c.account.owner.name.trim() } : null,
    lastActivityAt: toIso(lastActivityAt),
    createdAt: c.createdAt.toISOString(),
  };
}

const LEAD_ROW_SELECT = {
  id: true,
  name: true,
  phone: true,
  pipelineStage: true,
  createdAt: true,
  leadStage: { select: { id: true, name: true } },
  leadSource: { select: { name: true } },
  account: { select: { name: true, city: true, owner: { select: { id: true, name: true } } } },
} satisfies Prisma.AccountContactSelect;

/** Live contacts only, under a live company. */
const LIVE_CONTACT: Prisma.AccountContactWhereInput = { deletedAt: null, account: { deletedAt: null } };

/**
 * Ids of live contacts whose phone matches. With 10+ digits it is the same
 * last-10-digit comparison the CRM uses; shorter input (4-9 digits) matches
 * the end of the number, so "last six digits" lookups work.
 */
export async function contactIdsByPhoneFragment(raw: string): Promise<string[]> {
  const digits = digitsOnly(raw);
  if (digits.length < 4) return [];
  if (digits.length >= 10) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "account_contacts"
      WHERE deleted_at IS NULL AND phone IS NOT NULL
        AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${digits.slice(-10)}
      LIMIT 200`;
    return rows.map((r) => r.id);
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "account_contacts"
    WHERE deleted_at IS NULL AND phone IS NOT NULL
      AND regexp_replace(phone, '\\D', '', 'g') LIKE ${"%" + digits}
    LIMIT 200`;
  return rows.map((r) => r.id);
}

/** The where clause search_leads and get_pipeline share. Exported for tests. */
export async function buildLeadWhere(input: {
  q?: string;
  phone?: string;
  stageId?: string | "unstaged";
  ownerId?: string;
  source?: string;
  includeContacts?: boolean;
}): Promise<Prisma.AccountContactWhereInput> {
  const and: Prisma.AccountContactWhereInput[] = [LIVE_CONTACT];
  if (!input.includeContacts) and.push({ pipelineStage: "LEAD" });
  if (input.stageId === "unstaged") and.push({ leadStageId: null });
  else if (input.stageId) and.push({ leadStageId: input.stageId });
  if (input.ownerId) and.push({ account: { ownerUserId: input.ownerId } });
  if (input.source) {
    and.push(
      isUuid(input.source)
        ? { leadSourceId: input.source }
        : { leadSource: { name: { equals: input.source, mode: "insensitive" } } },
    );
  }
  if (input.phone) {
    const ids = await contactIdsByPhoneFragment(input.phone);
    and.push({ id: { in: ids } });
  }
  if (input.q) {
    const like = escapeLike(input.q);
    const or: Prisma.AccountContactWhereInput[] = [
      { name: { contains: like, mode: "insensitive" } },
      { account: { name: { contains: like, mode: "insensitive" } } },
    ];
    if (looksLikePhone(input.q)) {
      const ids = await contactIdsByPhoneFragment(input.q);
      if (ids.length) or.push({ id: { in: ids } });
    }
    and.push({ OR: or });
  }
  return { AND: and };
}

async function lastActivityByContact(ids: string[]): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const groups = await prisma.activity.groupBy({
    by: ["accountContactId"],
    where: { accountContactId: { in: ids } },
    _max: { occurredAt: true },
  });
  const out = new Map<string, Date>();
  for (const g of groups) if (g.accountContactId && g._max.occurredAt) out.set(g.accountContactId, g._max.occurredAt);
  return out;
}

export async function searchLeads(
  input: Pick<SearchLeadsInput, "q" | "phone" | "stageId" | "ownerId" | "source" | "includeContacts" | "limit" | "cursor">,
): Promise<{ items: LeadRow[]; nextCursor: string | null }> {
  const where = await buildLeadWhere(input);
  const rows = await prisma.accountContact.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: LEAD_ROW_SELECT,
  });
  const page = rows.slice(0, input.limit);
  const last = await lastActivityByContact(page.map((r) => r.id));
  return {
    items: page.map((r) => toLeadRow(r, last.get(r.id) ?? null)),
    nextCursor: rows.length > input.limit ? page[page.length - 1].id : null,
  };
}

// ---- get_lead ------------------------------------------------------------

type LeadDetail = z.infer<typeof leadDetailSchema>;

export type LeadDetailSource = {
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    designation: string | null;
    notes: string | null;
    fields: string;
    pipelineStage: string | null;
    promotedToLeadAt: Date | null;
    createdAt: Date;
    leadStage: { id: string; name: string } | null;
    leadSource: { name: string } | null;
    account: {
      id: string;
      name: string;
      city: string | null;
      businessType: string | null;
      customerProfile: { name: string } | null;
      owner: { id: string; name: string } | null;
    };
  };
  lastActivityAt: Date | null;
  notes: { id: string; title: string | null; body: string; createdAt: Date; author: { name: string } }[];
  nextActions: { id: string; text: string; dueAt: Date | null }[];
  tasks: { id: string; message: string; dueAt: Date; priority: string | null }[];
  activities: { id: string; subject: string; notes: string | null; outcome: string | null; occurredAt: Date; activityType: { name: string } }[];
  interests: { id: string; label: string | null; product: { name: string } | null; sport: { name: string } | null }[];
  deals: {
    id: string;
    code: string;
    title: string;
    wonValue: { toString(): string } | null;
    quotedValue: { toString(): string } | null;
    outcome: string | null;
    closedAt: Date | null;
    expectedStartAt: Date | null;
    executionStatus: string | null;
    currentStage: { name: string };
  }[];
  quotes: { id: string; number: string; sport: string; grandTotal: { toString(): string }; status: string; createdAt: Date; sentAt: Date | null }[];
  designs: { id: string; number: string; status: string; createdAt: Date; sentAt: Date | null }[];
};

/**
 * Picks exactly the fields the agent may see. Whatever else the query rows
 * carry (attachments, insights, storage URLs, cost) cannot get through.
 */
export function toLeadDetail(s: LeadDetailSource): LeadDetail {
  const c = s.contact;
  return {
    id: c.id,
    name: c.name.trim(),
    phone: c.phone,
    email: c.email,
    designation: c.designation,
    contactNote: c.notes,
    isLead: c.pipelineStage === "LEAD",
    stage: c.leadStage ? { id: c.leadStage.id, name: c.leadStage.name } : null,
    source: c.leadSource?.name ?? null,
    customFields: parseStringMap(c.fields),
    company: {
      id: c.account.id,
      name: c.account.name.trim(),
      city: c.account.city,
      businessType: c.account.businessType,
      customerProfile: c.account.customerProfile?.name ?? null,
    },
    rep: c.account.owner ? { id: c.account.owner.id, name: c.account.owner.name.trim() } : null,
    createdAt: c.createdAt.toISOString(),
    becameLeadAt: toIso(c.promotedToLeadAt),
    lastActivityAt: toIso(s.lastActivityAt),
    notes: s.notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      author: n.author.name,
    })),
    nextActions: s.nextActions.map((a) => ({ id: a.id, text: a.text, dueAt: toIso(a.dueAt) })),
    tasks: s.tasks.map((t) => ({ id: t.id, message: t.message, dueAt: t.dueAt.toISOString(), priority: t.priority })),
    recentActivities: s.activities.map((a) => ({
      id: a.id,
      type: a.activityType.name,
      subject: a.subject,
      notes: a.notes,
      outcome: a.outcome,
      occurredAt: a.occurredAt.toISOString(),
    })),
    productInterests: s.interests.map((p) => ({
      id: p.id,
      name: p.product?.name ?? p.label ?? "Unnamed product",
      sport: p.sport?.name ?? null,
    })),
    deals: s.deals.map((d) => ({
      id: d.id,
      code: d.code,
      title: d.title,
      valueInr: toNumber(d.wonValue) ?? toNumber(d.quotedValue),
      outcome: d.outcome,
      stage: d.currentStage.name,
      wonAt: toIso(d.closedAt),
      expectedStartAt: toIso(d.expectedStartAt),
      executionStatus: d.executionStatus,
    })),
    quotes: s.quotes.map((q) => ({
      id: q.id,
      number: q.number,
      sport: q.sport,
      totalInr: Number(q.grandTotal.toString()),
      status: q.status,
      createdAt: q.createdAt.toISOString(),
      sentAt: toIso(q.sentAt),
    })),
    courtDesigns: s.designs.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      sentAt: toIso(d.sentAt),
    })),
  };
}

export async function getLead(rawId: string | undefined): Promise<LeadDetail> {
  const id = requireId(rawId, "Lead");
  const contact = await prisma.accountContact.findFirst({
    where: { id, ...LIVE_CONTACT },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      designation: true,
      notes: true,
      fields: true,
      pipelineStage: true,
      promotedToLeadAt: true,
      createdAt: true,
      leadStage: { select: { id: true, name: true } },
      leadSource: { select: { name: true } },
      account: {
        select: {
          id: true,
          name: true,
          city: true,
          businessType: true,
          customerProfile: { select: { name: true } },
          owner: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!contact) throw new AgentHttpError("not_found", "Lead not found.");

  const deals = await prisma.deal.findMany({
    where: { primaryContactId: id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      code: true,
      title: true,
      wonValue: true,
      quotedValue: true,
      outcome: true,
      closedAt: true,
      expectedStartAt: true,
      executionStatus: true,
      currentStage: { select: { name: true } },
    },
  });
  const dealIds = deals.map((d) => d.id);
  const quoteOr: Prisma.QuotationWhereInput[] = [{ accountContactId: id }];
  if (dealIds.length) quoteOr.push({ dealId: { in: dealIds } });
  if (contact.phone) quoteOr.push({ contactPhone: contact.phone });

  const [notes, nextActions, tasks, activities, lastActivity, interests, quotes, designs] = await Promise.all([
    prisma.accountContactNote.findMany({
      where: { accountContactId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, body: true, createdAt: true, author: { select: { name: true } } },
    }),
    prisma.contactNextAction.findMany({
      where: { accountContactId: id, deletedAt: null, doneAt: null },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 20,
      select: { id: true, text: true, dueAt: true },
    }),
    prisma.reminder.findMany({
      where: {
        completedAt: null,
        nextAction: { is: null },
        OR: [{ accountContactId: id }, ...(dealIds.length ? [{ dealId: { in: dealIds } }] : [])],
      },
      orderBy: { dueAt: "asc" },
      take: 20,
      select: { id: true, message: true, dueAt: true, priority: true },
    }),
    prisma.activity.findMany({
      where: { accountContactId: id },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: { id: true, subject: true, notes: true, outcome: true, occurredAt: true, activityType: { select: { name: true } } },
    }),
    prisma.activity.aggregate({ where: { accountContactId: id }, _max: { occurredAt: true } }),
    prisma.contactProductInterest.findMany({
      where: { accountContactId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, label: true, product: { select: { name: true } }, sport: { select: { name: true } } },
    }),
    prisma.quotation.findMany({
      where: { OR: quoteOr },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, number: true, sport: true, grandTotal: true, status: true, createdAt: true, sentAt: true },
    }),
    prisma.courtImage.findMany({
      where: { OR: [{ accountContactId: id }, ...(dealIds.length ? [{ dealId: { in: dealIds } }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, number: true, status: true, createdAt: true, sentAt: true },
    }),
  ]);

  return toLeadDetail({
    contact,
    lastActivityAt: lastActivity._max.occurredAt,
    notes,
    nextActions,
    tasks,
    activities,
    interests,
    deals,
    quotes,
    designs,
  });
}

// ---- get_lead_timeline ----------------------------------------------------

/**
 * The agent reads the timeline as a non-admin viewer who authored nothing: the
 * visibility rules in canSeeContactEvent then hide every rep's private insight
 * activity. `__agent__` matches no insight author.
 */
export const AGENT_TIMELINE_VIEWER = { id: "__agent__", role: "ai_agent" } as const;

/** Drop what a customer-facing assistant must not read: insights and uploaded-file entries. */
export function filterAgentTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.filter((e) => {
    if (e.kind === "insight" || e.kind === "file") return false;
    if (e.kind === "change" && (e.label === "INSIGHT" || /^(file|insight)\b/i.test(e.title))) return false;
    return true;
  });
}

export function toTimelineItem(e: TimelineEntry): z.infer<typeof timelineItemSchema> {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    detail: e.detail,
    timestamp: e.timestamp,
    by: e.ownerName,
    ...(e.label ? { label: e.label } : {}),
  };
}

export async function getLeadTimeline(rawId: string | undefined, input: { limit: number; cursor?: string }) {
  const id = requireId(rawId, "Lead");
  const exists = await prisma.accountContact.findFirst({ where: { id, ...LIVE_CONTACT }, select: { id: true } });
  if (!exists) throw new AgentHttpError("not_found", "Lead not found.");
  const entries = await getContactTimeline(id, { ...AGENT_TIMELINE_VIEWER });
  return pageByOffset(filterAgentTimeline(entries).map(toTimelineItem), input.limit, input.cursor);
}

// ---- check_duplicates -----------------------------------------------------

export async function checkDuplicates(input: DuplicateCheckInput): Promise<{ hasDuplicates: boolean; matches: DuplicateMatch[] }> {
  const matches: DuplicateMatch[] = [];
  const seen = new Set<string>();
  const add = (m: DuplicateMatch) => {
    const key = `${m.type}:${m.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push(m);
  };

  const normalized = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !normalized) {
    throw new AgentHttpError("invalid_input", "phone is not a valid phone number.");
  }

  const contactType = (stage: string | null) => (stage === "LEAD" ? ("crm_lead" as const) : ("crm_contact" as const));

  // 1. CRM contacts / leads with this phone (last 10 digits, then normalised).
  const phoneIds = input.phone ? (await contactsMatchingPhone(input.phone)).map((r) => r.id) : [];
  const phoneContacts = phoneIds.length
    ? await prisma.accountContact.findMany({
        where: { id: { in: phoneIds } },
        select: {
          id: true,
          name: true,
          phone: true,
          accountId: true,
          pipelineStage: true,
          leadStage: { select: { name: true } },
          account: { select: { name: true } },
        },
      })
    : [];
  for (const c of phoneContacts) {
    add({
      type: contactType(c.pipelineStage),
      id: c.id,
      name: c.name,
      company: c.account.name,
      phoneLast4: phoneLast4(c.phone),
      matchedOn: "phone",
      confidence: "high",
      detail: c.leadStage?.name ?? null,
    });
  }

  // 2. The company, and a contact of that name inside it (the CRM's own rule).
  const account = input.company ? await findAccountDuplicate({ name: input.company, city: input.city }) : null;
  if (account) {
    add({
      type: "company",
      id: account.id,
      name: account.name,
      company: account.name,
      phoneLast4: null,
      matchedOn: "company_name",
      confidence: input.city ? "high" : "low",
      detail: account.city,
    });
    if (input.name) {
      // The phone index keeps the CRM helper from scanning the whole table.
      const index = new Map<string, AccountContactDuplicateCandidate>();
      for (const c of phoneContacts) {
        const canonical = c.phone ? normalizePhone(c.phone) : null;
        if (canonical) index.set(canonical, { id: c.id, name: c.name, phone: c.phone, accountId: c.accountId });
      }
      const dup = await findAccountContactDuplicate({ phone: input.phone, name: input.name, accountId: account.id }, index);
      if (dup && !seen.has(`crm_lead:${dup.id}`) && !seen.has(`crm_contact:${dup.id}`)) {
        const full = await prisma.accountContact.findFirst({
          where: { id: dup.id, deletedAt: null },
          select: { id: true, name: true, phone: true, pipelineStage: true, leadStage: { select: { name: true } }, account: { select: { name: true } } },
        });
        if (full) {
          add({
            type: contactType(full.pipelineStage),
            id: full.id,
            name: full.name,
            company: full.account.name,
            phoneLast4: phoneLast4(full.phone),
            matchedOn: "name_in_company",
            confidence: "high",
            detail: full.leadStage?.name ?? null,
          });
        }
      }
    }
  } else if (input.name && !input.phone) {
    // A name on its own is a weak signal: exact (case-insensitive) matches only, few of them.
    const sameName = await prisma.accountContact.findMany({
      where: { ...LIVE_CONTACT, name: { equals: input.name, mode: "insensitive" } },
      take: 5,
      select: { id: true, name: true, phone: true, pipelineStage: true, leadStage: { select: { name: true } }, account: { select: { name: true } } },
    });
    for (const c of sameName) {
      add({
        type: contactType(c.pipelineStage),
        id: c.id,
        name: c.name,
        company: c.account.name,
        phoneLast4: phoneLast4(c.phone),
        matchedOn: "name_only",
        confidence: "low",
        detail: c.leadStage?.name ?? null,
      });
    }
  }

  // 3. WhatsApp contact and Meta ad leads with this phone.
  if (normalized) {
    const [whatsapp, adLeads] = await Promise.all([
      prisma.contact.findUnique({ where: { phone: normalized }, select: { id: true, name: true, phone: true } }),
      prisma.metaLead.findMany({
        where: { normalizedPhone: normalized },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, fullName: true, phone: true, campaignName: true, stage: true },
      }),
    ]);
    if (whatsapp) {
      add({
        type: "whatsapp_contact",
        id: whatsapp.id,
        name: whatsapp.name,
        company: null,
        phoneLast4: phoneLast4(whatsapp.phone),
        matchedOn: "phone",
        confidence: "high",
        detail: null,
      });
    }
    for (const l of adLeads) {
      add({
        type: "ad_lead",
        id: l.id,
        name: l.fullName,
        company: null,
        phoneLast4: phoneLast4(l.phone),
        matchedOn: "phone",
        confidence: "high",
        detail: [l.campaignName, l.stage].filter(Boolean).join(" · ") || null,
      });
    }
  }

  return { hasDuplicates: matches.length > 0, matches };
}
