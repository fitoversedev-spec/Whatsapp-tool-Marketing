// Pipeline stage TYPES + pure helpers. This file is client-safe — no Prisma,
// no Node-only imports. Server-side DB helpers live in pipeline-server.ts so
// the client bundle doesn't try to pull Prisma's Node binaries in.

export type StageType = "active" | "won" | "lost";

export type PipelineStage = {
  id: string; // slug used as Conversation.pipelineStage value
  label: string; // display name
  color: string; // tailwind color class fragment, e.g. "slate", "blue"
  type: StageType;
  order: number;
};

export const DEFAULT_STAGES: PipelineStage[] = [
  { id: "new", label: "New", color: "slate", type: "active", order: 0 },
  { id: "qualified", label: "Qualified", color: "blue", type: "active", order: 1 },
  { id: "demo_scheduled", label: "Demo scheduled", color: "purple", type: "active", order: 2 },
  { id: "proposal_sent", label: "Proposal sent", color: "amber", type: "active", order: 3 },
  { id: "negotiation", label: "Negotiation", color: "orange", type: "active", order: 4 },
  { id: "won", label: "Won", color: "emerald", type: "won", order: 5 },
  { id: "lost", label: "Lost", color: "red", type: "lost", order: 6 },
];

// Tailwind color tokens we recognize. Kept as static strings so the JIT
// can find them at build time (tailwind purges classes it can't see).
export const STAGE_COLOR_CLASSES: Record<
  string,
  { ring: string; bg: string; text: string; dot: string; soft: string }
> = {
  slate: {
    ring: "ring-slate-300",
    bg: "bg-slate-100",
    text: "text-slate-700",
    dot: "bg-slate-400",
    soft: "bg-slate-50",
  },
  blue: {
    ring: "ring-blue-300",
    bg: "bg-blue-100",
    text: "text-blue-700",
    dot: "bg-blue-500",
    soft: "bg-blue-50",
  },
  purple: {
    ring: "ring-purple-300",
    bg: "bg-purple-100",
    text: "text-purple-700",
    dot: "bg-purple-500",
    soft: "bg-purple-50",
  },
  amber: {
    ring: "ring-amber-300",
    bg: "bg-amber-100",
    text: "text-amber-800",
    dot: "bg-amber-500",
    soft: "bg-amber-50",
  },
  orange: {
    ring: "ring-orange-300",
    bg: "bg-orange-100",
    text: "text-orange-700",
    dot: "bg-orange-500",
    soft: "bg-orange-50",
  },
  emerald: {
    ring: "ring-emerald-300",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    soft: "bg-emerald-50",
  },
  red: {
    ring: "ring-red-300",
    bg: "bg-red-100",
    text: "text-red-700",
    dot: "bg-red-500",
    soft: "bg-red-50",
  },
};

export function colorFor(color: string) {
  return STAGE_COLOR_CLASSES[color] ?? STAGE_COLOR_CLASSES.slate;
}

export function daysSince(d: Date | null): number {
  if (!d) return 0;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
