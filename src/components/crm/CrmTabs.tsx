"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/crm", label: "Dashboard" },
  { href: "/crm/contacts", label: "Contacts" },
  { href: "/crm/leads", label: "Leads" },
  { href: "/crm/companies", label: "Customer types" },
  { href: "/deals", label: "Deals" },
  { href: "/crm/activities", label: "Activities" },
  { href: "/crm/import", label: "Import" },
  // No longer admin-only — every approved role gets a self-scoped view
  // (see requireAnalyticsAccess() in src/lib/auth.ts / resolveAnalyticsScope()
  // in src/lib/analytics/scope.ts).
  { href: "/crm/analytics", label: "Analytics" },
];

// isAdmin kept as a prop for any future admin-only tab — none currently
// need it now that Analytics is self-service for every approved role.
export default function CrmTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();

  return (
    <div className="border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8 overflow-x-auto">
      <nav className="flex gap-1 -mb-px min-w-max">
        {TABS.map((tab) => {
          // "/crm" itself must match exactly — every other CRM route starts
          // with "/crm/" too, which would otherwise light up Dashboard always.
          const active =
            tab.href === "/crm" ? pathname === "/crm" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                active
                  ? "border-wa-green text-wa-dark"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
