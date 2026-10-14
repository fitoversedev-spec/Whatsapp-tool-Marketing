/**
 * list_designs and get_design: metadata only. No layout JSON, no picture links,
 * no staff-written caption; just what exists and in which formats. Both are
 * scoped to the customer the caller names (see customer.ts), so a design id
 * alone opens nothing.
 */
import type { z } from "zod/v4";
import { prisma } from "@/lib/prisma";
import { sportsByCourtImageId } from "@/lib/court-image/list";
import { existingDesignFormats } from "@/lib/court-image/send";
import { AgentHttpError } from "../errors";
import { requireId, toIso } from "../read/shared";
import type { getDesignQuery, listDesignsQuery } from "../schemas/documents";
import type { AgentHandler } from "../withAgent";
import { designScope, resolveDesignCustomer } from "./customer";

const BASE_SELECT = {
  id: true,
  number: true,
  customerName: true,
  status: true,
  imageUrl: true,
  image2dUrl: true,
  image3dUrl: true,
  video3dUrl: true,
  dealId: true,
  sentAt: true,
  createdAt: true,
  updatedAt: true,
  createdByUserId: true,
} as const;

export type DesignRow = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  imageUrl: string | null;
  image2dUrl: string | null;
  image3dUrl: string | null;
  video3dUrl: string | null;
  dealId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
};

export function toDesignDto(
  row: DesignRow,
  extra: { sports: string[]; plot: { lengthFt: number; widthFt: number } | null },
  agentUserId: string,
) {
  const have = new Set(existingDesignFormats(row));
  return {
    id: row.id,
    number: row.number,
    customerName: row.customerName,
    status: row.status,
    sports: extra.sports,
    plot: extra.plot,
    formats: { twoD: have.has("2d"), threeDImage: have.has("3d-image"), threeDVideo: have.has("3d-video") },
    needsDrawing: have.size === 0,
    createdBy: row.createdByUserId === agentUserId ? ("ai_agent" as const) : ("staff" as const),
    dealId: row.dealId,
    sentAt: toIso(row.sentAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Sports and plot size out of a stored layout; anything unreadable is empty. */
export function layoutSummary(layoutJson: string): { sports: string[]; plot: { lengthFt: number; widthFt: number } | null } {
  try {
    const l = JSON.parse(layoutJson) as { sports?: unknown; plot?: { lengthFt?: unknown; widthFt?: unknown } };
    const sports = Array.isArray(l.sports) ? l.sports.filter((s): s is string => typeof s === "string") : [];
    const { lengthFt, widthFt } = l.plot ?? {};
    const plot = typeof lengthFt === "number" && typeof widthFt === "number" ? { lengthFt, widthFt } : null;
    return { sports, plot };
  } catch {
    return { sports: [], plot: null };
  }
}

export const listDesigns: AgentHandler<z.infer<typeof listDesignsQuery>> = async ({ ctx, input }) => {
  const customer = await resolveDesignCustomer(input);
  const scope = await designScope(customer);
  if (!scope) return { body: { designs: [] }, recordIds: [] };

  const rows = (await prisma.courtImage.findMany({
    where: scope,
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: BASE_SELECT,
  })) as DesignRow[];
  const sports = await sportsByCourtImageId(rows.map((r) => r.id));
  return {
    body: { designs: rows.map((r) => toDesignDto(r, { sports: sports.get(r.id) ?? [], plot: null }, ctx.userId)) },
    recordIds: rows.map((r) => r.id),
  };
};

export const getDesign: AgentHandler<z.infer<typeof getDesignQuery>> = async ({ ctx, input, params }) => {
  const id = requireId(params.id, "Design");
  const customer = await resolveDesignCustomer(input);
  const scope = await designScope(customer);
  // Not theirs looks exactly like not there.
  if (!scope) throw new AgentHttpError("not_found", "Design not found.");

  const row = (await prisma.courtImage.findFirst({
    where: { AND: [{ id }, scope] },
    select: { ...BASE_SELECT, layout: true },
  })) as (DesignRow & { layout: string }) | null;
  if (!row) throw new AgentHttpError("not_found", "Design not found.");
  return { body: { design: toDesignDto(row, layoutSummary(row.layout), ctx.userId) }, recordIds: [row.id] };
};
