// Tag color tokens. Shared across Tag, ConversationLabel, and any other
// surface that uses the same vocabulary.

export type Tag = {
  id: string;
  name: string;
  color: string;
  contactCount?: number;
};

export const TAG_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "emerald",
  "blue",
  "purple",
  "pink",
] as const;

export const TAG_COLOR_CLASSES: Record<
  string,
  { bg: string; text: string; dot: string; ring: string }
> = {
  slate: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    dot: "bg-slate-400",
    ring: "ring-slate-300",
  },
  red: {
    bg: "bg-red-100",
    text: "text-red-700",
    dot: "bg-red-500",
    ring: "ring-red-300",
  },
  orange: {
    bg: "bg-orange-100",
    text: "text-orange-700",
    dot: "bg-orange-500",
    ring: "ring-orange-300",
  },
  amber: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    dot: "bg-amber-500",
    ring: "ring-amber-300",
  },
  emerald: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    ring: "ring-emerald-300",
  },
  blue: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    dot: "bg-blue-500",
    ring: "ring-blue-300",
  },
  purple: {
    bg: "bg-purple-100",
    text: "text-purple-700",
    dot: "bg-purple-500",
    ring: "ring-purple-300",
  },
  pink: {
    bg: "bg-pink-100",
    text: "text-pink-700",
    dot: "bg-pink-500",
    ring: "ring-pink-300",
  },
};
