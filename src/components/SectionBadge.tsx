"use client";

import { usePathname } from "next/navigation";

// Tool-wide "which mode am I in" indicator. Two contexts only:
//   • CRM            — the CRM tabbed area plus Deals & Pipeline (conceptually
//                      CRM; these historically carried the standalone CRM band).
//   • WhatsApp Marketing — everything else in the tool (Inbox, Broadcasts,
//                      Contacts, Templates, etc.).
// Colours: CRM keeps the Fitoverse brand green (#159341); WhatsApp Marketing
// uses the WhatsApp palette (dark-teal text + bright-green dot) so the two are
// distinguishable at a glance, not just by their label text.
const CRM_PREFIXES = ["/crm", "/deals", "/pipeline"];

function resolveSection(pathname: string) {
  const isCrm = CRM_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return isCrm
    ? { label: "CRM", pill: "bg-[#159341]/10 text-[#159341]", dot: "bg-[#159341]" }
    : { label: "WhatsApp Marketing", pill: "bg-wa-green/10 text-wa-dark", dot: "bg-wa-green" };
}

export default function SectionBadge({ compact = false }: { compact?: boolean }) {
  const section = resolveSection(usePathname() ?? "");

  if (compact) {
    // Collapsed sidebar: just the coloured dot (label would overflow 68px).
    return <span className={`w-2.5 h-2.5 rounded-full ${section.dot}`} title={section.label} aria-label={section.label} />;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${section.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${section.dot}`} />
      {section.label}
    </span>
  );
}
