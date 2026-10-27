"use client";

import Link from "next/link";
import { labelChip } from "@/lib/meta-ads/lead-fields";
import type { LeadBadge } from "@/lib/website-leads/badges";

// Small pieces the Website leads list and detail page share. Client-safe: types
// only come from the server modules (no runtime import of prisma code).

// Each badge links to the existing record it points at.
function badgeHref(b: LeadBadge): string {
  switch (b.kind) {
    case "crm":
      return `/crm/contacts/${b.id}`;
    case "ad_lead":
      return `/ad-campaigns/leads/${b.id}`;
    case "whatsapp":
      return `/contacts/${b.id}`;
  }
}

const BADGE_CLS: Record<LeadBadge["kind"], string> = {
  crm: "bg-green-100 text-green-700",
  ad_lead: "bg-blue-100 text-blue-700",
  whatsapp: "bg-teal-100 text-teal-700",
};

export function LeadBadges({ badges }: { badges: LeadBadge[] }) {
  if (badges.length === 0) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <Link
          key={`${b.kind}-${b.id}`}
          href={badgeHref(b)}
          onClick={(e) => e.stopPropagation()}
          title={`Open the existing record — ${b.label}`}
          className={`badge whitespace-nowrap hover:underline ${BADGE_CLS[b.kind]}`}
        >
          {b.label}
        </Link>
      ))}
    </div>
  );
}

// Where the lead came from: a small chip tinted by its group (the label colours the
// Labels use). A lead the website sent no attribution for reads "Unknown", faint.
const CAME_FROM_COLOR: Record<string, string> = {
  "AI assistants": "violet",
  Search: "blue",
  "Paid ads": "amber",
  Social: "pink",
  Email: "teal",
  "Other websites": "orange",
  Direct: "slate",
};

export function CameFromChip({ cameFrom, group }: { cameFrom: string | null; group: string | null }) {
  const label = cameFrom ?? "Unknown";
  const tint = cameFrom ? labelChip(CAME_FROM_COLOR[group ?? ""] ?? "slate") : "border-dashed border-slate-300 text-slate-400";
  // Kept narrow on purpose: the leads table is tuned to fit a 1280px laptop.
  return (
    <span
      title={label}
      className={`inline-block max-w-[8rem] truncate rounded-full border px-1.5 py-0.5 align-middle text-[10px] font-medium leading-4 ${tint}`}
    >
      {label}
    </span>
  );
}

const fmtNum = (n: number) => n.toLocaleString("en-IN");

/** "60 × 40 ft" when both sides are known, else "2,400 sq ft"; null when nothing is known. */
export function courtSizeText(l: { lengthFt: number | null; widthFt: number | null; areaSqft: number | null }): string | null {
  if (l.lengthFt != null && l.widthFt != null) return `${fmtNum(l.lengthFt)} × ${fmtNum(l.widthFt)} ft`;
  if (l.areaSqft != null) return `${fmtNum(l.areaSqft)} sq ft`;
  return null;
}

/** The area as a second line, only when the sides are shown too. */
export function courtAreaText(l: { lengthFt: number | null; widthFt: number | null; areaSqft: number | null }): string | null {
  return l.lengthFt != null && l.widthFt != null && l.areaSqft != null ? `${fmtNum(l.areaSqft)} sq ft` : null;
}
