// Server-side paging, filtering, facets, id-listing, export and detail for the
// website leads table. Mirrors src/lib/meta-ads/lead-list.ts (and reuses its
// date-range parser, "contains" escaping and tally merging). Filters: received
// date range, city, sport, court size (sq ft) range, stage, rep (a name, a user id
// or "unassigned"), label (exact name), where the lead came from (a label such as
// "ChatGPT", or "unknown" for leads saved before the website sent attribution) and
// a search on name / phone / email. Removed leads (WebsiteLead.deletedAt set) are
// hidden everywhere except the `removed` list filter, which admins and managers use
// to see them (and bring them back) — the routes decide who may set it.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_LEADS_PER_REQUEST } from "@/lib/broadcast-groups";
import { likeLiteral, mergeTally, parseLeadRange, type LeadOption, type LeadTally } from "@/lib/meta-ads/lead-list";
import { getBadgesForLead, getBadgesForLeads, type LeadBadge } from "./badges";
import type { WebsiteLeadAttribution } from "./ingest";

export { parseLeadRange };
export const WEBSITE_LEADS_PAGE_SIZE = 50;
// "Select all N matching" ceiling — the same cap the assign / add-to-group routes accept.
export const WEBSITE_LEAD_IDS_CAP = MAX_LEADS_PER_REQUEST;
export const WEBSITE_LEAD_EXPORT_CAP = 10_000;

export type WebsiteLeadFilters = {
  from: Date;
  to: Date;
  city?: string;
  sport?: string;
  areaMin?: number; // court size, sq ft
  areaMax?: number;
  stage?: string; // MetaLeadStage.slug, exact
  assigned?: string; // "unassigned", a user id, or part of a rep's name
  label?: string; // label name, exact
  cameFrom?: string; // where it came from: a classifier label (any case) or "unknown" for no attribution
  q?: string; // name / phone / email
  removed?: boolean; // true = ONLY the removed leads; default = only the leads that are not removed
};

export type WebsiteLeadLabelChip = { id: string; name: string; color: string };

export type WebsiteLeadRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  sport: string | null;
  areaSqft: number | null;
  lengthFt: number | null;
  widthFt: number | null;
  startWhen: string | null;
  surface: string | null; // the website page / surface the form was filled on
  cameFrom: string | null; // "ChatGPT", "Google search", "Direct"...; null = no attribution ("Unknown")
  cameFromGroup: string | null; // "AI assistants", "Search", "Paid ads", "Social", "Email", "Other websites", "Direct"
  stage: string;
  labels: WebsiteLeadLabelChip[];
  assignedToUserId: string | null;
  assignedToName: string | null;
  inCrm: boolean; // moved to the CRM (accountContactId set)
  inMarketing: boolean; // moved to WhatsApp marketing (contactId set)
  receivedAt: string; // ISO
  removedAt: string | null; // ISO; set only on a removed lead, and only when the query asked for removed ones (list `removed`, detail `includeRemoved`)
  badges: LeadBadge[]; // duplicate badges, worked out when read
};

export type WebsiteLeadBreakdown = {
  city: LeadTally[];
  sport: LeadTally[];
  assigned: LeadTally[];
  cameFrom: LeadTally[]; // leads with no attribution are counted as "Unknown"
};
export type WebsiteLeadOptions = WebsiteLeadBreakdown & {
  labels: LeadOption[];
  stages: { slug: string; count: number }[];
  total: number; // every lead in the date window, ignoring the dropdown filters
};

export type WebsiteLeadPage = {
  rows: WebsiteLeadRow[];
  total: number;
  page: number;
  pageCount: number;
  maxSelectable: number;
};

export type WebsiteLeadExportRow = {
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  jobTitle: string | null;
  sport: string | null;
  areaSqft: number | null;
  lengthFt: number | null;
  widthFt: number | null;
  startWhen: string | null;
  surface: string | null;
  notes: string | null;
  cameFrom: string | null;
  campaign: string | null; // utm_campaign
  landingPage: string | null;
  stage: string;
  assignedToName: string | null;
  labels: string;
  receivedAt: string;
  inCrm: boolean;
};

// Newest first; id last so paging never repeats or skips a row on equal timestamps.
const LEAD_ORDER = [{ receivedAt: "desc" as const }, { id: "asc" as const }];
const UNKNOWN_CAME_FROM = "unknown";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildWebsiteLeadWhere(f: WebsiteLeadFilters): Prisma.WebsiteLeadWhereInput {
  const and: Prisma.WebsiteLeadWhereInput[] = [
    { deletedAt: f.removed ? { not: null } : null },
    { receivedAt: { gte: f.from, lte: f.to } },
  ];

  const city = f.city?.trim();
  if (city) and.push({ city: { contains: likeLiteral(city), mode: "insensitive" } });
  const sport = f.sport?.trim();
  if (sport) and.push({ sport: { contains: likeLiteral(sport), mode: "insensitive" } });
  if (f.areaMin != null || f.areaMax != null) {
    and.push({
      areaSqft: {
        ...(f.areaMin != null ? { gte: f.areaMin } : {}),
        ...(f.areaMax != null ? { lte: f.areaMax } : {}),
      },
    });
  }
  if (f.stage) and.push({ stage: f.stage });
  if (f.label) and.push({ labels: { some: { label: { name: f.label } } } });
  const cameFrom = f.cameFrom?.trim();
  if (cameFrom) {
    and.push(
      cameFrom.toLowerCase() === UNKNOWN_CAME_FROM
        ? { cameFrom: null }
        : { cameFrom: { equals: cameFrom, mode: "insensitive" } },
    );
  }

  const assigned = f.assigned?.trim();
  if (assigned) {
    if (assigned.toLowerCase() === "unassigned") and.push({ assignedToUserId: null });
    else if (UUID.test(assigned)) and.push({ assignedToUserId: assigned });
    else and.push({ assignedTo: { name: { contains: likeLiteral(assigned), mode: "insensitive" } } });
  }

  const q = f.q?.trim();
  if (q) {
    const or: Prisma.WebsiteLeadWhereInput[] = [
      { name: { contains: likeLiteral(q), mode: "insensitive" } },
      { email: { contains: likeLiteral(q), mode: "insensitive" } },
      { phone: { contains: likeLiteral(q) } },
    ];
    // "98765 43210" and "+91 98765-43210" should both find 919876543210.
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ normalizedPhone: { contains: digits } });
    and.push({ OR: or });
  }

  return { AND: and };
}

// ---------------------------------------------------------------------------
// Page / ids / export
// ---------------------------------------------------------------------------

export const WEBSITE_LEAD_SELECT = {
  id: true,
  name: true,
  phone: true,
  normalizedPhone: true,
  email: true,
  city: true,
  state: true,
  sport: true,
  areaSqft: true,
  lengthFt: true,
  widthFt: true,
  startWhen: true,
  surface: true,
  cameFrom: true,
  cameFromGroup: true,
  stage: true,
  assignedToUserId: true,
  accountContactId: true,
  contactId: true,
  receivedAt: true,
  assignedTo: { select: { name: true } },
  labels: {
    select: { label: { select: { id: true, name: true, color: true } } },
    orderBy: { labeledAt: "asc" as const },
  },
} as const;

type Selected = Prisma.WebsiteLeadGetPayload<{ select: typeof WEBSITE_LEAD_SELECT }>;

// When a lead was removed is selected only by queries that may return removed leads;
// the live list (and the AI agent, which reuses it) never reads the column.
const withRemovedAt = (on?: boolean) => (on ? { deletedAt: true as const } : {});

export function toWebsiteLeadRow(l: Selected & { deletedAt?: Date | null }, badges: LeadBadge[] = []): WebsiteLeadRow {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    city: l.city,
    state: l.state,
    sport: l.sport,
    areaSqft: l.areaSqft,
    lengthFt: l.lengthFt,
    widthFt: l.widthFt,
    startWhen: l.startWhen,
    surface: l.surface ?? null,
    cameFrom: l.cameFrom ?? null,
    cameFromGroup: l.cameFromGroup ?? null,
    stage: l.stage,
    labels: l.labels.map((j) => j.label),
    assignedToUserId: l.assignedToUserId,
    assignedToName: l.assignedTo?.name ?? null,
    inCrm: l.accountContactId != null,
    inMarketing: l.contactId != null,
    receivedAt: l.receivedAt.toISOString(),
    removedAt: l.deletedAt?.toISOString() ?? null,
    badges,
  };
}

export async function getWebsiteLeadPage(
  f: WebsiteLeadFilters,
  page: number,
  pageSize: number = WEBSITE_LEADS_PAGE_SIZE,
): Promise<WebsiteLeadPage> {
  const where = buildWebsiteLeadWhere(f);
  const wanted = Math.max(1, Math.floor(page) || 1);
  const fetchRows = (p: number) =>
    prisma.websiteLead.findMany({
      where,
      orderBy: LEAD_ORDER,
      skip: (p - 1) * pageSize,
      take: pageSize,
      select: { ...WEBSITE_LEAD_SELECT, ...withRemovedAt(f.removed) },
    });

  const [total, firstTry] = await Promise.all([prisma.websiteLead.count({ where }), fetchRows(wanted)]);
  let leads = firstTry;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  let current = wanted;
  if (wanted > pageCount) {
    // The list shrank under the viewer — show the last page.
    current = pageCount;
    leads = await fetchRows(current);
  }
  const badges = await getBadgesForLeads(leads);
  return {
    rows: leads.map((l) => toWebsiteLeadRow(l, badges.get(l.id))),
    total,
    page: current,
    pageCount,
    maxSelectable: WEBSITE_LEAD_IDS_CAP,
  };
}

// Every matching lead id (for "Select all N matching"), up to the cap.
export async function getWebsiteLeadIds(f: WebsiteLeadFilters): Promise<{ ids: string[]; total: number }> {
  const where = buildWebsiteLeadWhere(f);
  const [total, rows] = await Promise.all([
    prisma.websiteLead.count({ where }),
    prisma.websiteLead.findMany({ where, orderBy: LEAD_ORDER, take: WEBSITE_LEAD_IDS_CAP, select: { id: true } }),
  ]);
  return { ids: rows.map((r) => r.id), total };
}

// Rows for the CSV / XLSX export.
export async function getWebsiteLeadExportRows(
  f: WebsiteLeadFilters,
): Promise<{ rows: WebsiteLeadExportRow[]; total: number }> {
  const where = buildWebsiteLeadWhere(f);
  const [total, leads] = await Promise.all([
    prisma.websiteLead.count({ where }),
    prisma.websiteLead.findMany({
      where,
      orderBy: LEAD_ORDER,
      take: WEBSITE_LEAD_EXPORT_CAP,
      select: {
        name: true,
        phone: true,
        email: true,
        city: true,
        state: true,
        jobTitle: true,
        sport: true,
        areaSqft: true,
        lengthFt: true,
        widthFt: true,
        startWhen: true,
        surface: true,
        notes: true,
        cameFrom: true,
        landingPage: true,
        attribution: true,
        stage: true,
        accountContactId: true,
        receivedAt: true,
        assignedTo: { select: { name: true } },
        labels: { select: { label: { select: { name: true } } }, orderBy: { labeledAt: "asc" } },
      },
    }),
  ]);
  return {
    total,
    rows: leads.map((l) => ({
      name: l.name,
      phone: l.phone,
      email: l.email,
      city: l.city,
      state: l.state,
      jobTitle: l.jobTitle,
      sport: l.sport,
      areaSqft: l.areaSqft,
      lengthFt: l.lengthFt,
      widthFt: l.widthFt,
      startWhen: l.startWhen,
      surface: l.surface ?? null,
      notes: l.notes,
      cameFrom: l.cameFrom ?? null,
      campaign: parseAttribution(l.attribution)?.utm_campaign ?? null,
      landingPage: l.landingPage ?? null,
      stage: l.stage,
      assignedToName: l.assignedTo?.name ?? null,
      labels: l.labels.map((j) => j.label.name).join(", "),
      receivedAt: l.receivedAt.toISOString(),
      inCrm: l.accountContactId != null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Facets: dropdown options (whole date window) and the breakdown lists (the filtered set)
// ---------------------------------------------------------------------------

async function columnTally(
  where: Prisma.WebsiteLeadWhereInput,
  column: "city" | "sport" | "cameFrom",
): Promise<LeadTally[]> {
  const groups = await prisma.websiteLead.groupBy({ by: [column], where, _count: { _all: true } });
  // A lead the website sent no attribution for is "Unknown" (not the blank dash of a missing city).
  const blank = column === "cameFrom" ? "Unknown" : null;
  return mergeTally(groups.map((g) => ({ raw: g[column] ?? blank, count: g._count._all })));
}

async function assignedTally(where: Prisma.WebsiteLeadWhereInput): Promise<LeadTally[]> {
  const groups = await prisma.websiteLead.groupBy({ by: ["assignedToUserId"], where, _count: { _all: true } });
  const ids = groups.map((g) => g.assignedToUserId).filter((x): x is string => !!x);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return mergeTally(
    groups.map((g) => ({
      raw: g.assignedToUserId ? (nameById.get(g.assignedToUserId) ?? "Unassigned") : "Unassigned",
      count: g._count._all,
    })),
  );
}

async function computeBreakdown(where: Prisma.WebsiteLeadWhereInput): Promise<WebsiteLeadBreakdown> {
  const [city, sport, assigned, cameFrom] = await Promise.all([
    columnTally(where, "city"),
    columnTally(where, "sport"),
    assignedTally(where),
    columnTally(where, "cameFrom"),
  ]);
  return { city, sport, assigned, cameFrom };
}

async function labelOptions(base: Prisma.WebsiteLeadWhereInput): Promise<LeadOption[]> {
  const groups = await prisma.websiteLeadToLabel.groupBy({
    by: ["labelId"],
    where: { websiteLead: base },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];
  const labels = await prisma.metaLeadLabel.findMany({
    where: { id: { in: groups.map((g) => g.labelId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(labels.map((l) => [l.id, l.name]));
  const byName = new Map<string, number>();
  for (const g of groups) {
    const name = nameById.get(g.labelId);
    if (name) byName.set(name, (byName.get(name) ?? 0) + g._count._all);
  }
  return [...byName.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

async function computeOptions(base: Prisma.WebsiteLeadWhereInput): Promise<WebsiteLeadOptions> {
  const [breakdown, labels, stageGroups, total] = await Promise.all([
    computeBreakdown(base),
    labelOptions(base),
    prisma.websiteLead.groupBy({ by: ["stage"], where: base, _count: { _all: true } }),
    prisma.websiteLead.count({ where: base }),
  ]);
  return {
    ...breakdown,
    labels,
    stages: stageGroups.map((g) => ({ slug: g.stage, count: g._count._all })),
    total,
  };
}

const hasDropdownFilter = (f: WebsiteLeadFilters) =>
  !!(
    f.city?.trim() ||
    f.sport?.trim() ||
    f.areaMin != null ||
    f.areaMax != null ||
    f.stage ||
    f.assigned?.trim() ||
    f.label ||
    f.cameFrom?.trim() ||
    f.q?.trim()
  );

export async function getWebsiteLeadFacets(
  f: WebsiteLeadFilters,
  want: { options?: boolean; breakdown?: boolean },
): Promise<{ options?: WebsiteLeadOptions; breakdown?: WebsiteLeadBreakdown }> {
  const filtered = hasDropdownFilter(f);
  const baseWhere = buildWebsiteLeadWhere({ from: f.from, to: f.to, removed: f.removed });

  // Options always describe the whole window; with no filter the breakdown is the same numbers.
  const needOptions = !!want.options || (!!want.breakdown && !filtered);
  const needBreakdown = !!want.breakdown && filtered;
  const [options, breakdown] = await Promise.all([
    needOptions ? computeOptions(baseWhere) : undefined,
    needBreakdown ? computeBreakdown(buildWebsiteLeadWhere(f)) : undefined,
  ]);

  const out: { options?: WebsiteLeadOptions; breakdown?: WebsiteLeadBreakdown } = {};
  if (want.options && options) out.options = options;
  if (want.breakdown) {
    out.breakdown = breakdown ?? {
      city: options!.city,
      sport: options!.sport,
      assigned: options!.assigned,
      cameFrom: options!.cameFrom,
    };
  }
  return out;
}

// Page 1 + dropdown options, for a server-rendered first paint.
export async function getInitialWebsiteLeadList(
  f: WebsiteLeadFilters,
): Promise<WebsiteLeadPage & { options: WebsiteLeadOptions }> {
  const [page, facets] = await Promise.all([getWebsiteLeadPage(f, 1), getWebsiteLeadFacets(f, { options: true })]);
  return { ...page, options: facets.options! };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type WebsiteLeadNoteRow = {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type WebsiteLeadDetail = WebsiteLeadRow & {
  jobTitle: string | null;
  notes: string | null; // the customer's own message
  answers: { key: string; label: string; value: string }[]; // answers to the form's custom questions
  surface: string | null;
  env: string | null;
  source: string | null;
  landingPage: string | null; // path of the first page of the visit
  attribution: WebsiteLeadAttribution | null; // referrer / utm_* / click_id; null = the website sent none
  accountContactId: string | null; // the CRM contact it was moved to
  contactId: string | null; // the WhatsApp marketing contact it was moved to
  internalNotes: WebsiteLeadNoteRow[]; // reps' notes, newest first
};

function cleanAnswers(raw: unknown): WebsiteLeadDetail["answers"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({ key: String(a.key ?? ""), label: String(a.label ?? a.key ?? ""), value: String(a.value ?? "") }));
}

// The stored attribution JSON text, read back (null when absent or unreadable).
function parseAttribution(raw: string | null): WebsiteLeadAttribution | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as WebsiteLeadAttribution) : null;
  } catch {
    return null;
  }
}

// One website lead with everything the detail page shows; null when it doesn't exist
// (or is removed, unless includeRemoved — only the admin / manager callers pass it).
export async function getWebsiteLeadDetail(
  id: string,
  opts: { includeRemoved?: boolean } = {},
): Promise<WebsiteLeadDetail | null> {
  const lead = await prisma.websiteLead.findFirst({
    where: opts.includeRemoved ? { id } : { id, deletedAt: null },
    select: {
      ...WEBSITE_LEAD_SELECT,
      ...withRemovedAt(opts.includeRemoved),
      jobTitle: true,
      notes: true,
      answers: true,
      surface: true,
      env: true,
      source: true,
      landingPage: true,
      attribution: true,
      internalNotes: {
        orderBy: { createdAt: "desc" },
        select: { id: true, body: true, createdAt: true, authorUserId: true, author: { select: { name: true } } },
      },
    },
  });
  if (!lead) return null;
  const badges = await getBadgesForLead(lead);
  return {
    ...toWebsiteLeadRow(lead, badges),
    jobTitle: lead.jobTitle,
    notes: lead.notes,
    answers: cleanAnswers(lead.answers),
    surface: lead.surface,
    env: lead.env,
    source: lead.source,
    landingPage: lead.landingPage,
    attribution: parseAttribution(lead.attribution),
    accountContactId: lead.accountContactId,
    contactId: lead.contactId,
    internalNotes: lead.internalNotes.map((n) => ({
      id: n.id,
      authorUserId: n.authorUserId,
      authorName: n.author?.name ?? "—",
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}
