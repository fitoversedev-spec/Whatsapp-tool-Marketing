"use client";

import { usePathname } from "next/navigation";
import { ALL_TOOLS_GROUPS } from "./AllToolsPanel";

// Tool-wide "which mode am I in" indicator. The label reflects the All-Tools
// SECTION the current page belongs to (e.g. "Meta Ads" on /ad-campaigns,
// "CRM" on /crm, "Marketing & Sales" on /templates), derived from the single
// source of truth ALL_TOOLS_GROUPS. Pages not in any group (Inbox, Broadcasts,
// Contacts, Search, Reminders, Bot leads — the core WhatsApp surface) keep the
// default "WhatsApp Marketing".
//
// Flatten groups → {href, title}, longest href first so the more specific route
// wins (/ad-campaigns/lead-analytics over /ad-campaigns, /crm/analytics over
// /crm). /pipeline isn't in any group but is conceptually CRM, so it's added.
const SECTION_ROUTES: { href: string; title: string }[] = ALL_TOOLS_GROUPS
  .flatMap((g) => g.items.map((it) => ({ href: it.href, title: g.title })))
  .concat([{ href: "/pipeline", title: "CRM" }])
  .sort((a, b) => b.href.length - a.href.length);

// Per-section pill colours. MUST be complete literal class strings — Tailwind's
// JIT can't see classes built by string concatenation.
const SECTION_STYLE: Record<string, { pill: string; dot: string }> = {
  CRM: { pill: "bg-[#2E7D4F]/10 text-[#205537]", dot: "bg-[#2E7D4F]" }, // turf
  "Meta Ads": { pill: "bg-[#1C6E8C]/10 text-[#144B61]", dot: "bg-[#1C6E8C]" }, // court
  "Marketing & Sales": { pill: "bg-[#7c3aed]/10 text-[#7c3aed]", dot: "bg-[#7c3aed]" }, // accent (orthogonal)
  Organization: { pill: "bg-slate-500/10 text-slate-600", dot: "bg-slate-500" },
  Admin: { pill: "bg-[#B33A26]/10 text-[#7C271A]", dot: "bg-[#B33A26]" }, // track
};
const DEFAULT_STYLE = { pill: "bg-wa-green/10 text-wa-dark", dot: "bg-wa-green" };

function resolveSection(pathname: string) {
  const hit = SECTION_ROUTES.find(
    (r) => pathname === r.href || pathname.startsWith(r.href + "/"),
  );
  const label = hit?.title ?? "WhatsApp Marketing";
  const style = (hit && SECTION_STYLE[hit.title]) || DEFAULT_STYLE;
  return { label, ...style };
}

export default function SectionBadge({ compact = false }: { compact?: boolean }) {
  const section = resolveSection(usePathname() ?? "");

  if (compact) {
    // Collapsed sidebar: just the coloured dot (label would overflow 68px).
    return <span className={`w-2.5 h-2.5 rounded-full ${section.dot}`} title={section.label} aria-label={section.label} />;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wide whitespace-nowrap ${section.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${section.dot}`} />
      {section.label}
    </span>
  );
}
