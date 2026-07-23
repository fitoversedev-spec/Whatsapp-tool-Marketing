// Phase 2 (analytics v2) — extends funnel.ts's funnelSnapshot() concept (a
// single flat "what does the pipeline look like right now" view) with a
// segment/source lens and a value-only reshape (A6). Same "deal sitting in
// its current stage right now" semantics as funnelSnapshot — not a cohort
// query (cohorts.ts, separate file, answers "where did month M's deals end
// up," a harder question).
import { prisma } from "@/lib/prisma";
import type { AnalyticsFilter } from "./types";
import { funnelSnapshot } from "./funnel";

function dealValue(d: { wonValue: unknown; quotedValue: unknown; estimatedValue: unknown }): number {
  const v = d.wonValue ?? d.quotedValue ?? d.estimatedValue;
  return v ? Number(v) : 0;
}

export type SegmentFunnelRow = { stageId: string; stageName: string; sortOrder: number; profileName: string; count: number; value: number };
export type SourcePathRow = { stageId: string; stageName: string; sortOrder: number; sourceName: string; count: number; value: number };
export type ValueFunnelRow = { stageId: string; stageName: string; sortOrder: number; count: number; value: number };

export async function segmentFunnel(filter: AnalyticsFilter): Promise<SegmentFunnelRow[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const [stages, deals] = await Promise.all([
    prisma.funnelStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.deal.findMany({
      where: { deletedAt: null, ...ownerWhere, ...dealChannelWhere },
      select: {
        currentStageId: true,
        wonValue: true,
        quotedValue: true,
        estimatedValue: true,
        account: { select: { customerProfile: { select: { name: true } } } },
      },
    }),
  ]);

  const stageMeta = new Map(stages.map((s) => [s.id, { name: s.name, sortOrder: s.sortOrder }]));
  const map = new Map<string, { count: number; value: number }>();
  for (const d of deals) {
    // A deal sitting on a since-deactivated stage doesn't surface here —
    // same behavior as funnelSnapshot(), which only maps over active stages.
    if (!stageMeta.has(d.currentStageId)) continue;
    const profileName = d.account.customerProfile?.name ?? "(unclassified)";
    const key = `${d.currentStageId}|${profileName}`;
    const e = map.get(key) ?? { count: 0, value: 0 };
    e.count += 1;
    e.value += dealValue(d);
    map.set(key, e);
  }

  return [...map.entries()]
    .map(([key, v]) => {
      const [stageId, profileName] = key.split("|");
      const stage = stageMeta.get(stageId)!;
      return { stageId, stageName: stage.name, sortOrder: stage.sortOrder, profileName, count: v.count, value: v.value };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.profileName.localeCompare(b.profileName));
}

export async function sourcePathFunnel(filter: AnalyticsFilter): Promise<SourcePathRow[]> {
  const ownerWhere = filter.ownerIds?.length ? { ownerUserId: { in: filter.ownerIds } } : {};
  const dealChannelWhere = filter.dealChannel ? { dealChannel: filter.dealChannel } : {};

  const [stages, sourceTaxonomy, deals] = await Promise.all([
    prisma.funnelStage.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.leadSource.findMany({ select: { id: true, name: true } }),
    prisma.deal.findMany({
      where: { deletedAt: null, ...ownerWhere, ...dealChannelWhere },
      select: { currentStageId: true, leadSourceId: true, wonValue: true, quotedValue: true, estimatedValue: true },
    }),
  ]);

  const stageMeta = new Map(stages.map((s) => [s.id, { name: s.name, sortOrder: s.sortOrder }]));
  // Same fallback as sources.ts's own nameFor(): a known-but-deleted-taxonomy
  // id reads as "(unknown source)", a genuinely unset one as "(unspecified)".
  const sourceNameById = new Map(sourceTaxonomy.map((s) => [s.id, s.name]));
  const nameFor = (id: string | null) => (id ? sourceNameById.get(id) ?? "(unknown source)" : "(unspecified)");

  const map = new Map<string, { count: number; value: number }>();
  for (const d of deals) {
    if (!stageMeta.has(d.currentStageId)) continue;
    const sourceName = nameFor(d.leadSourceId);
    const key = `${d.currentStageId}|${sourceName}`;
    const e = map.get(key) ?? { count: 0, value: 0 };
    e.count += 1;
    e.value += dealValue(d);
    map.set(key, e);
  }

  return [...map.entries()]
    .map(([key, v]) => {
      const [stageId, sourceName] = key.split("|");
      const stage = stageMeta.get(stageId)!;
      return { stageId, stageName: stage.name, sortOrder: stage.sortOrder, sourceName, count: v.count, value: v.value };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.sourceName.localeCompare(b.sourceName));
}

// funnelSnapshot()'s FunnelStageRow.value already computes exactly this
// (per-stage sum of wonValue??quotedValue??estimatedValue) — reshaping its
// output is a straight relabel, not a fresh query. Confirmed sufficient; see
// report.
export async function valueFunnel(filter: AnalyticsFilter): Promise<ValueFunnelRow[]> {
  const { stages } = await funnelSnapshot(filter);
  return stages.map((s) => ({ stageId: s.stageId, stageName: s.stageName, sortOrder: s.sortOrder, count: s.count, value: s.value }));
}
