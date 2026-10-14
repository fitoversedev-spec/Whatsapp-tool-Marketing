import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { buildLeadWhere, getLeadPage, parseLeadRange, type LeadFilters } from "@/lib/meta-ads/lead-list";
import { getLeadAnalytics } from "@/lib/meta-ads/leadAnalytics";
import { getMetaLeadDetail, type MetaLeadDetail, type MetaLeadRow } from "@/lib/meta-ads/queries";
import { parseFieldDataJson } from "@/lib/meta-ads/fieldMap";
import { AgentHttpError } from "../errors";
import type { AdLeadRow, AdLeadsInput, adLeadDetailSchema } from "../schemas/read";
import { requireId } from "./shared";

/**
 * Ad (Meta lead-form) leads for the agent. Reuses the Ad Campaigns list
 * (buildLeadWhere / getLeadPage) and the detail query; there is no export, and
 * raw form payloads / Meta ids never leave the server.
 */

export function toAgentAdLead(r: MetaLeadRow): AdLeadRow {
  return {
    id: r.id,
    name: r.fullName,
    phone: r.phone,
    email: r.email,
    formName: r.formName,
    campaignName: r.campaignName,
    city: r.city,
    sport: r.sport,
    area: r.area,
    startTime: r.startTime,
    stage: r.stage,
    labels: r.labels.map((l) => l.name),
    assignedTo: r.assignedToName,
    inCrm: r.inCrm,
    capturedAt: r.capturedAt,
  };
}

export function adLeadFilters(input: Pick<AdLeadsInput, "from" | "to" | "campaign" | "city" | "sport" | "area" | "start" | "stage" | "assigned" | "label">): LeadFilters {
  const { from, to } = parseLeadRange(input.from, input.to);
  return {
    from,
    to,
    campaignId: input.campaign,
    city: input.city,
    sport: input.sport,
    area: input.area,
    start: input.start,
    stage: input.stage,
    assigned: input.assigned,
    label: input.label,
  };
}

export async function listAdLeads(input: AdLeadsInput) {
  const filters = adLeadFilters(input);
  const where = await buildLeadWhere(filters);
  const page = await getLeadPage(filters, input.page, where, input.limit);
  return {
    items: page.rows.map(toAgentAdLead),
    total: page.total,
    page: page.page,
    pageCount: page.pageCount,
    limit: input.limit,
  };
}

function parseSalesData(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toAgentAdLeadDetail(d: MetaLeadDetail): z.infer<typeof adLeadDetailSchema> {
  return {
    ...toAgentAdLead(d),
    formAnswers: parseFieldDataJson(d.fieldData),
    salesData: parseSalesData(d.salesData),
    notes: d.notes.map((n) => ({ id: n.id, body: n.body, author: n.authorName, createdAt: n.createdAt })),
    reminders: d.reminders.map((r) => ({
      id: r.id,
      message: r.message,
      dueAt: r.dueAt,
      status: r.status,
      completedAt: r.completedAt,
    })),
  };
}

export async function getAdLead(rawId: string | undefined) {
  const id = requireId(rawId, "Ad lead");
  const detail = await getMetaLeadDetail(id);
  if (!detail) throw new AgentHttpError("not_found", "Ad lead not found.");
  return toAgentAdLeadDetail(detail);
}

/** Repeat submitters are people: keep the count and the first few, without their phone numbers. */
const REPEATS_SHOWN = 10;

export async function getAdLeadAnalytics(input: { from?: string; to?: string }) {
  const range = parseLeadRange(input.from, input.to);
  const a = await getLeadAnalytics(range);
  const { repeats, ...rest } = a;
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    analytics: {
      ...rest,
      repeatSubmitters: {
        total: repeats.length,
        top: repeats.slice(0, REPEATS_SHOWN).map((r) => ({
          name: r.name,
          campaignCount: r.campaignCount,
          firstAt: r.firstAt,
          lastAt: r.lastAt,
        })),
      },
    } as Record<string, unknown>,
  };
}

/** Stage options for the ad-lead stage filter (the filter matches the slug). */
export async function listAdLeadStages(): Promise<{ slug: string; name: string }[]> {
  const rows = await prisma.metaLeadStage.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { slug: true, name: true },
  });
  return rows;
}
