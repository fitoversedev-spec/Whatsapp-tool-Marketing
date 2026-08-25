// Shared, dependency-free constants for the Meta lead-management sidebar
// (Stage pipeline + label colour palette). Imported by BOTH the server (the
// PATCH/labels API routes, the read queries) and the client (the sidebar UI),
// so this file must stay free of any server-only imports (no prisma, no auth).

// The lead pipeline, mirroring the Meta Leads Centre stages plus a "Contacted"
// step and a terminal "Lost". Stored on MetaLead.stage as the UPPERCASE key;
// NEW is the default for every already-captured lead.
export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  CONVERTED: "Converted",
  LOST: "Lost",
};

// Tailwind class pairs for the stage chip (kept as literal strings so Tailwind's
// JIT sees them). Neutral for New, warming through the funnel, green = won,
// rose = lost.
export const LEAD_STAGE_CHIP: Record<LeadStage, string> = {
  NEW: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-blue-100 text-blue-700",
  QUALIFIED: "bg-amber-100 text-amber-700",
  CONVERTED: "bg-green-100 text-green-700",
  LOST: "bg-rose-100 text-rose-700",
};

export function isLeadStage(v: unknown): v is LeadStage {
  return typeof v === "string" && (LEAD_STAGES as readonly string[]).includes(v);
}

export function stageLabel(stage: string): string {
  return isLeadStage(stage) ? LEAD_STAGE_LABELS[stage] : stage;
}

// Label colour palette — the small named set a rep can pick from when creating a
// label. Each maps to a chip class pair. Keys are stored on MetaLeadLabel.color.
export const LABEL_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const LABEL_CHIP: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  red: "bg-red-100 text-red-700 border-red-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  green: "bg-green-100 text-green-700 border-green-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  violet: "bg-violet-100 text-violet-700 border-violet-200",
  pink: "bg-pink-100 text-pink-700 border-pink-200",
};

// A label colour dot swatch (solid), for the colour picker + chip prefix.
export const LABEL_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export function labelChip(color: string): string {
  return LABEL_CHIP[color] ?? LABEL_CHIP.slate;
}

export function labelDot(color: string): string {
  return LABEL_DOT[color] ?? LABEL_DOT.slate;
}

export function isLabelColor(v: unknown): v is LabelColor {
  return typeof v === "string" && (LABEL_COLORS as readonly string[]).includes(v);
}
