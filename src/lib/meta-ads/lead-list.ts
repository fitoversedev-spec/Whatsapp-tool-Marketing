// Server-side paging, filtering, facets, id-listing and export for the Ad
// Campaigns lead tables (the all-leads list and each campaign's leads tab).
// Everything the table used to do over the whole lead array in the browser now
// runs here, so the page ships 50 light rows instead of every lead's raw form
// answers. Filter semantics mirror what LeadsTable used to do client-side:
// city / sport / area / assigned are case-insensitive "contains", stage and
// label are exact, start time is an exact match on the tidied answer.
//
// Raw fieldData never leaves the server: start time and the area fallback are
// derived here, and the few filters that need fieldData (start time, the area
// fallback for old rows) scan { id, fieldData } server-side only.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_LEADS_PER_REQUEST } from "@/lib/broadcast-groups";
import { extractStartTime, START_TIME_ORDER } from "./fieldMap";
import { deriveArea, leadWindowWhere, META_LEAD_SELECT, toMetaLeadRow, type MetaLeadRow } from "./queries";

export const LEADS_PAGE_SIZE = 50;
// "Select all N matching" ceiling — the same cap the assign / add-to-group routes accept.
export const LEAD_IDS_CAP = MAX_LEADS_PER_REQUEST;
export const LEAD_EXPORT_CAP = 10_000;

export type LeadFilters = {
  from: Date;
  to: Date;
  campaignId?: string; // raw Meta campaign id (MetaLead.campaignId)
  city?: string;
  sport?: string;
  area?: string;
  start?: string;
  stage?: string;
  assigned?: string;
  label?: string;
};

export type LeadTally = { key: string; label: string; count: number };
export type LeadOption = { label: string; count: number };
export type LeadBreakdown = { city: LeadTally[]; sport: LeadTally[]; area: LeadTally[]; assigned: LeadTally[] };
export type LeadOptions = LeadBreakdown & {
  labels: LeadOption[];
  startTimes: LeadOption[];
  total: number; // every lead in the window / campaign, ignoring the dropdown filters
};

export type LeadPage = {
  rows: MetaLeadRow[];
  total: number; // leads matching the filters (all pages)
  page: number;
  pageCount: number;
  maxSelectable: number;
};
export type LeadListInitial = LeadPage & { options: LeadOptions };

export type LeadExportRow = {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  sport: string | null;
  area: string | null;
  formName: string | null;
  campaignName: string | null;
  stage: string;
  capturedAt: string; // ISO — the browser formats it, as the old export did
  inCrm: boolean;
};

// Same ?from/?to convention as the Ad Campaigns pages: blank => all-time
// (2000-01-01..now); a malformed value falls back instead of throwing inside
// Prisma; the upper bound is pushed to end-of-day.
export function parseLeadRange(fromRaw?: string | null, toRaw?: string | null): { from: Date; to: Date } {
  let from = new Date("2000-01-01T00:00:00Z");
  if (fromRaw) {
    const d = new Date(fromRaw + "T00:00:00");
    if (!Number.isNaN(d.getTime())) from = d;
  }
  let to = new Date();
  if (toRaw) {
    const d = new Date(toRaw + "T23:59:59");
    if (!Number.isNaN(d.getTime())) to = d;
  }
  return { from, to };
}

// Newest first; id last so paging never repeats or skips a row on equal timestamps.
const LEAD_ORDER = [{ createdAtMeta: "desc" as const }, { createdAt: "desc" as const }, { id: "asc" as const }];
// Rows whose area column is empty — the area is then read from the form answers.
const NO_AREA: Prisma.MetaLeadWhereInput = { OR: [{ area: null }, { area: "" }] };

// Prisma's contains is a LIKE: escape \, % and _ so typed text matches
// literally, like the old in-browser filter did.
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, "\\$&");
export async function buildLeadWhere(f: LeadFilters): Promise<Prisma.MetaLeadWhereInput> {
  const and: Prisma.MetaLeadWhereInput[] = [leadWindowWhere(f)];
  if (f.campaignId) and.push({ campaignId: f.campaignId });

  const city = f.city?.trim();
  if (city) and.push({ city: { contains: likeLiteral(city), mode: "insensitive" } });
  const sport = f.sport?.trim();
  if (sport) and.push({ sport: { contains: likeLiteral(sport), mode: "insensitive" } });
  if (f.stage) and.push({ stage: f.stage });
  if (f.label) and.push({ labels: { some: { label: { name: f.label } } } });

  // The table matched on the shown name, which reads "Unassigned" with no rep.
  const assigned = f.assigned?.trim().toLowerCase();
  if (assigned) {
    const or: Prisma.MetaLeadWhereInput[] = [{ assignedTo: { name: { contains: likeLiteral(assigned), mode: "insensitive" } } }];
    if ("unassigned".includes(assigned)) or.push({ assignedToUserId: null });
    and.push({ OR: or });
  }

  const area = f.area?.trim();
  if (area) {
    // Old rows with no area column still match on the area found in their form answers.
    const blank = await prisma.metaLead.findMany({
      where: { AND: [...and, NO_AREA] },
      select: { id: true, fieldData: true },
    });
    const needle = area.toLowerCase();
    const viaForm = blank
      .filter((r) => (deriveArea(null, r.fieldData) ?? "").toLowerCase().includes(needle))
      .map((r) => r.id);
    const or: Prisma.MetaLeadWhereInput[] = [{ area: { contains: likeLiteral(area), mode: "insensitive" } }];
    if (viaForm.length > 0) or.push({ id: { in: viaForm } });
    and.push({ OR: or });
  }

  if (f.start) {
    // Exact match, so "1–3 months" never also catches "Within 3 months".
    const rows = await prisma.metaLead.findMany({ where: { AND: and }, select: { id: true, fieldData: true } });
    and.push({ id: { in: rows.filter((r) => extractStartTime(r.fieldData) === f.start).map((r) => r.id) } });
  }

  return { AND: and };
}

// ---------------------------------------------------------------------------
// Page / ids / export
// ---------------------------------------------------------------------------

// `prebuilt` lets a caller that already ran buildLeadWhere (it can scan form
// answers) reuse it for the page and the breakdown instead of building it twice.
export async function getLeadPage(
  f: LeadFilters,
  page: number,
  prebuilt?: Prisma.MetaLeadWhereInput,
): Promise<LeadPage> {
  const where = prebuilt ?? (await buildLeadWhere(f));
  const wanted = Math.max(1, Math.floor(page) || 1);
  const fetchRows = (p: number) =>
    prisma.metaLead.findMany({
      where,
      orderBy: LEAD_ORDER,
      skip: (p - 1) * LEADS_PAGE_SIZE,
      take: LEADS_PAGE_SIZE,
      select: META_LEAD_SELECT,
    });

  const [total, firstTry] = await Promise.all([prisma.metaLead.count({ where }), fetchRows(wanted)]);
  let leads = firstTry;
  const pageCount = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  let current = wanted;
  if (wanted > pageCount) {
    // The list shrank under the viewer (e.g. a filter or a removed lead) — show the last page.
    current = pageCount;
    leads = await fetchRows(current);
  }
  return { rows: leads.map(toMetaLeadRow), total, page: current, pageCount, maxSelectable: LEAD_IDS_CAP };
}

// Every matching lead id (for "Select all N matching"), up to the cap.
export async function getLeadIds(f: LeadFilters): Promise<{ ids: string[]; total: number }> {
  const where = await buildLeadWhere(f);
  const [total, rows] = await Promise.all([
    prisma.metaLead.count({ where }),
    prisma.metaLead.findMany({ where, orderBy: LEAD_ORDER, take: LEAD_IDS_CAP, select: { id: true } }),
  ]);
  return { ids: rows.map((r) => r.id), total };
}

// Rows for the CSV / XLSX export — same columns the table always exported.
export async function getLeadExportRows(f: LeadFilters): Promise<{ rows: LeadExportRow[]; total: number }> {
  const where = await buildLeadWhere(f);
  const [total, leads, blank] = await Promise.all([
    prisma.metaLead.count({ where }),
    prisma.metaLead.findMany({
      where,
      orderBy: LEAD_ORDER,
      take: LEAD_EXPORT_CAP,
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        city: true,
        sport: true,
        area: true,
        formName: true,
        campaignName: true,
        stage: true,
        accountContactId: true,
        createdAtMeta: true,
        createdAt: true,
      },
    }),
    // Form answers are only read for rows with no stored area (the fallback).
    prisma.metaLead.findMany({
      where: { AND: [where, NO_AREA] },
      orderBy: LEAD_ORDER,
      take: LEAD_EXPORT_CAP,
      select: { id: true, fieldData: true },
    }),
  ]);
  const fallback = new Map(blank.map((r) => [r.id, deriveArea(null, r.fieldData)]));
  return {
    total,
    rows: leads.map((l) => ({
      fullName: l.fullName,
      phone: l.phone,
      email: l.email,
      city: l.city,
      sport: l.sport,
      area: l.area || (fallback.get(l.id) ?? l.area),
      formName: l.formName,
      campaignName: l.campaignName,
      stage: l.stage,
      capturedAt: (l.createdAtMeta ?? l.createdAt).toISOString(),
      inCrm: l.accountContactId != null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Facets: dropdown options (whole window / campaign) and the breakdown lists
// (the filtered set)
// ---------------------------------------------------------------------------

// Merge raw values case-insensitively (key = trimmed, lower-cased; blank = "—"),
// biggest first — the same rule the table's tally() used. The shown label is the
// spelling most leads used.
function mergeTally(items: { raw: string | null; count: number }[]): LeadTally[] {
  const m = new Map<string, LeadTally & { best: number }>();
  for (const it of items) {
    const raw = (it.raw ?? "").trim();
    const key = raw.toLowerCase() || "—";
    const label = raw || "—";
    const cur = m.get(key);
    if (!cur) m.set(key, { key, label, count: it.count, best: it.count });
    else {
      cur.count += it.count;
      if (it.count > cur.best) {
        cur.label = label;
        cur.best = it.count;
      }
    }
  }
  return [...m.values()]
    .map(({ key, label, count }) => ({ key, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

async function columnTally(where: Prisma.MetaLeadWhereInput, column: "city" | "sport"): Promise<LeadTally[]> {
  const groups = await prisma.metaLead.groupBy({ by: [column], where, _count: { _all: true } });
  return mergeTally(groups.map((g) => ({ raw: g[column], count: g._count._all })));
}

async function assignedTally(where: Prisma.MetaLeadWhereInput): Promise<LeadTally[]> {
  const groups = await prisma.metaLead.groupBy({ by: ["assignedToUserId"], where, _count: { _all: true } });
  const ids = groups.map((g) => g.assignedToUserId).filter((x): x is string => !!x);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return mergeTally(
    groups.map((g) => ({
      raw: g.assignedToUserId ? nameById.get(g.assignedToUserId) ?? "Unassigned" : "Unassigned",
      count: g._count._all,
    })),
  );
}

async function areaTally(where: Prisma.MetaLeadWhereInput): Promise<LeadTally[]> {
  const [groups, blank] = await Promise.all([
    prisma.metaLead.groupBy({ by: ["area"], where, _count: { _all: true } }),
    // Rows with no stored area: read it from the form answers instead.
    prisma.metaLead.findMany({ where: { AND: [where, NO_AREA] }, select: { fieldData: true } }),
  ]);
  const items = groups.filter((g) => g.area).map((g) => ({ raw: g.area, count: g._count._all }));
  for (const r of blank) items.push({ raw: deriveArea(null, r.fieldData), count: 1 });
  return mergeTally(items);
}

async function computeBreakdown(where: Prisma.MetaLeadWhereInput): Promise<LeadBreakdown> {
  const [city, sport, area, assigned] = await Promise.all([
    columnTally(where, "city"),
    columnTally(where, "sport"),
    areaTally(where),
    assignedTally(where),
  ]);
  return { city, sport, area, assigned };
}

async function labelOptions(base: Prisma.MetaLeadWhereInput): Promise<LeadOption[]> {
  const groups = await prisma.metaLeadToLabel.groupBy({
    by: ["labelId"],
    where: { metaLead: base },
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

async function computeOptions(base: Prisma.MetaLeadWhereInput): Promise<LeadOptions> {
  const [city, sport, assigned, labels, scan] = await Promise.all([
    columnTally(base, "city"),
    columnTally(base, "sport"),
    assignedTally(base),
    labelOptions(base),
    // Start time and the area fallback both live in the form answers, so one
    // server-side read of the window serves both.
    prisma.metaLead.findMany({ where: base, select: { area: true, fieldData: true } }),
  ]);

  const startCounts = new Map<string, number>();
  const areaItems: { raw: string | null; count: number }[] = [];
  for (const r of scan) {
    areaItems.push({ raw: deriveArea(r.area, r.fieldData), count: 1 });
    const st = extractStartTime(r.fieldData);
    if (st) startCounts.set(st, (startCounts.get(st) ?? 0) + 1);
  }
  // Soonest first (an unfamiliar answer goes last).
  const rank = (s: string) => {
    const i = START_TIME_ORDER.indexOf(s);
    return i < 0 ? START_TIME_ORDER.length : i;
  };
  const startTimes = [...startCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => rank(a.label) - rank(b.label) || b.count - a.count);

  return { city, sport, area: mergeTally(areaItems), assigned, labels, startTimes, total: scan.length };
}

const hasDropdownFilter = (f: LeadFilters) =>
  !!(f.city?.trim() || f.sport?.trim() || f.area?.trim() || f.start || f.stage || f.assigned?.trim() || f.label);

export async function getLeadFacets(
  f: LeadFilters,
  want: { options?: boolean; breakdown?: boolean },
  prebuilt?: Prisma.MetaLeadWhereInput,
): Promise<{ options?: LeadOptions; breakdown?: LeadBreakdown }> {
  const filtered = hasDropdownFilter(f);
  const baseWhere = await buildLeadWhere({ from: f.from, to: f.to, campaignId: f.campaignId });

  // Options always describe the whole window; with no filter the breakdown is the same numbers.
  const needOptions = !!want.options || (!!want.breakdown && !filtered);
  const needBreakdown = !!want.breakdown && filtered;
  const [options, breakdown] = await Promise.all([
    needOptions ? computeOptions(baseWhere) : undefined,
    needBreakdown ? (prebuilt ? computeBreakdown(prebuilt) : buildLeadWhere(f).then(computeBreakdown)) : undefined,
  ]);

  const out: { options?: LeadOptions; breakdown?: LeadBreakdown } = {};
  if (want.options && options) out.options = options;
  if (want.breakdown) {
    out.breakdown = breakdown ?? { city: options!.city, sport: options!.sport, area: options!.area, assigned: options!.assigned };
  }
  return out;
}

// Page 1 + dropdown options, for a server-rendered first paint.
export async function getInitialLeadList(f: LeadFilters): Promise<LeadListInitial> {
  const [page, facets] = await Promise.all([getLeadPage(f, 1), getLeadFacets(f, { options: true })]);
  return { ...page, options: facets.options! };
}
