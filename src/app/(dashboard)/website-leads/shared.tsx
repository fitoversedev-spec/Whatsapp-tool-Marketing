"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
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

// The "Remove" confirmation, on the list's bulk bar and on the lead's page. Same
// look as the CRM "Remove from Leads" confirm (src/app/(crm-app)/crm/leads/LeadsClient.tsx).
export function RemoveLeadsDialog({
  title,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Keyboard: focus lands on Cancel (the safe choice) and Escape closes, unless a save is running.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 mb-1">{title}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          They&apos;ll be hidden from Fito Website (Leads and Analytics). Any CRM or WhatsApp marketing copies stay. You
          can bring them back with Show removed.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn btn-danger"
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
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
