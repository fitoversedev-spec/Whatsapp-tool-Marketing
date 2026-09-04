"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_LINKS = [
  { href: "/scout/admin/users", label: "Users" },
  { href: "/scout/admin/scoring", label: "Scoring" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="ss-scroll border-b border-slate-200 bg-white">
      <div className="flex gap-1 px-10 pt-2">
        {ADMIN_LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-colors ${
                active
                  ? "text-court-600 bg-court-50"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              {link.label}
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-court-500 rounded-full" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
