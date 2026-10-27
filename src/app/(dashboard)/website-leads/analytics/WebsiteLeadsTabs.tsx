"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const TABS = [
  { key: "leads", label: "Leads" },
  { key: "analytics", label: "Analytics" },
] as const;

// Leads | Analytics, switched by ?tab=analytics. Every other query parameter
// (the leads date range) rides along, so coming back to Leads finds the same page.
export default function WebsiteLeadsTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  const params = useSearchParams();

  function hrefFor(tab: (typeof TABS)[number]["key"]) {
    const next = new URLSearchParams(params.toString());
    if (tab === "analytics") next.set("tab", "analytics");
    else next.delete("tab");
    const qs = next.toString();
    return qs ? `/website-leads?${qs}` : "/website-leads";
  }

  return (
    <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto" aria-label="Fito Website sections">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={hrefFor(t.key)}
          scroll={false}
          aria-current={active === t.key ? "page" : undefined}
          className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${
            active === t.key
              ? "border-court-600 text-court-700 font-semibold"
              : "border-transparent text-slate-500 font-medium hover:text-slate-800"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
