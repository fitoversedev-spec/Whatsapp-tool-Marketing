// Generic service for the 7 admin-editable taxonomy lists (spec §0.2: every
// list the business calls a "list" must be editable at runtime, never
// hardcoded). All 7 share the same base shape (id/name/slug/sortOrder/
// isActive/colorHex/deletedAt) — FunnelStage and LeadSource each carry a
// few extra fields on top, handled via the `extraFields` passthrough below
// rather than one bespoke service per type.
//
// "Delete" always means isActive=false + deletedAt (never a hard delete),
// matching the existing Template.deletedAt/User.deletedAt soft-delete
// precedent — this is what makes "block delete of a referenced row, offer
// deactivate instead" trivially true: the row never actually goes away.
import { prisma } from "@/lib/prisma";

export const TAXONOMY_TYPES = [
  "funnel-stages",
  "lead-sources",
  "customer-profiles",
  "city-tiers",
  "loss-reasons",
  "activity-types",
] as const;
export type TaxonomyType = (typeof TAXONOMY_TYPES)[number];

function delegateFor(type: TaxonomyType) {
  switch (type) {
    case "funnel-stages":
      return prisma.funnelStage;
    case "lead-sources":
      return prisma.leadSource;
    case "customer-profiles":
      return prisma.customerProfile;
    case "city-tiers":
      return prisma.cityTier;
    case "loss-reasons":
      return prisma.lossReason;
    case "activity-types":
      return prisma.activityType;
  }
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export async function listTaxonomy(type: TaxonomyType) {
  const delegate = delegateFor(type) as { findMany: (args: unknown) => Promise<unknown[]> };
  return delegate.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } });
}

export type TaxonomyInput = {
  name: string;
  colorHex?: string | null;
  sortOrder?: number;
  // FunnelStage-only
  stageType?: "active" | "won" | "lost";
  probabilityPercent?: number | null;
  slaHours?: number | null;
  requiresLossReason?: boolean;
  // LeadSource-only
  parentId?: string | null;
};

export async function createTaxonomyRow(type: TaxonomyType, input: TaxonomyInput) {
  const delegate = delegateFor(type) as { create: (args: unknown) => Promise<unknown>; count: (args: unknown) => Promise<number> };
  const slug = slugify(input.name);
  const sortOrder = input.sortOrder ?? (await delegate.count({ where: { deletedAt: null } }));
  const base = { name: input.name, slug, sortOrder, colorHex: input.colorHex ?? null };
  const extra =
    type === "funnel-stages"
      ? {
          stageType: input.stageType ?? "active",
          probabilityPercent: input.probabilityPercent ?? null,
          slaHours: input.slaHours ?? null,
          requiresLossReason: input.requiresLossReason ?? false,
        }
      : type === "lead-sources"
        ? { parentId: input.parentId ?? null }
        : {};
  return delegate.create({ data: { ...base, ...extra } });
}

export type TaxonomyPatch = Partial<TaxonomyInput> & { isActive?: boolean; deleted?: boolean };

// deleted:true is a soft delete UNLESS the row is referenced elsewhere and
// the caller should have shown a "deactivate instead" prompt — this
// function doesn't second-guess that; it always does isActive:false when
// deleted:true, since a hard delete is never offered at all (see file header).
export async function updateTaxonomyRow(type: TaxonomyType, id: string, patch: TaxonomyPatch) {
  const delegate = delegateFor(type) as { update: (args: unknown) => Promise<unknown> };
  const { deleted, name, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (name) {
    data.name = name;
    data.slug = slugify(name);
  }
  if (deleted) {
    data.isActive = false;
    data.deletedAt = new Date();
  }
  return delegate.update({ where: { id }, data });
}

// "At least one WON and one LOST FunnelStage must always exist" (spec
// §5.2) — checked before deactivating a funnel stage.
export async function wouldRemoveLastStageOfType(id: string, stageType: "won" | "lost"): Promise<boolean> {
  const row = await prisma.funnelStage.findUnique({ where: { id } });
  if (!row || row.stageType !== stageType) return false;
  const remaining = await prisma.funnelStage.count({
    where: { stageType, isActive: true, deletedAt: null, id: { not: id } },
  });
  return remaining === 0;
}
