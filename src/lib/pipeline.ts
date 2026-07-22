// Pipeline stage TYPES + pure helpers. This file is client-safe — no Prisma,
// no Node-only imports. Server-side DB helpers live in pipeline-server.ts so
// the client bundle doesn't try to pull Prisma's Node binaries in.
//
// Stages themselves come from the real FunnelStage taxonomy (13 rows,
// admin-editable via /admin/taxonomies) — this used to be a separate,
// hardcoded 7-stage config with no relationship to the Deal-based stage
// system Team Performance reads, which meant the pipeline board and the
// analytics it's supposed to feed showed different stages entirely (see
// docs/DECISIONS.md). `color` now holds a real hex value straight from
// FunnelStage.colorHex, not a fixed Tailwind token — colors are
// admin-editable and open-ended, so this renders via inline styles
// wherever it's used, never dynamically-built Tailwind class names
// (Tailwind's JIT purger can't see those; same reasoning already applied
// to the Taxonomies admin UI itself).

export type StageType = "active" | "won" | "lost";

export type PipelineStage = {
  id: string; // FunnelStage.slug, also the value stored in Conversation.pipelineStage
  stageId: string; // FunnelStage's real uuid — what POST /api/deals/[id]/stage's toStageId actually expects
  label: string;
  color: string; // hex, e.g. "#3b82f6"
  type: StageType;
  order: number;
};

const FALLBACK_HEX = "#64748b";

function isValidHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

// Derived visual values for a stage's color, computed at render time from
// its hex — a light alpha-tinted background plus the solid hex for
// text/dots/borders. Same alpha-suffix-on-hex trick already used by
// DealsClient.tsx's StageBadge for the exact same FunnelStage colors.
export function stageVisual(color: string) {
  const hex = isValidHex(color) ? color : FALLBACK_HEX;
  return {
    hex,
    soft: `${hex}14`, // ~8% alpha — resting tint
    strong: `${hex}26`, // ~15% alpha — column header band
  };
}

export function daysSince(d: Date | null): number {
  if (!d) return 0;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
