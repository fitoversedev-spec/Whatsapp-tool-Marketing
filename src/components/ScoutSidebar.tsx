"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import ThemeToggle from "./ThemeToggle";
import type { Role } from "@/lib/rbac";

type Props = {
  user: { name: string; email: string; role: Role };
};

const SCOUT_NAV = [
  { href: "/scout/dashboard", label: "Dashboard", icon: "\u{1F4CA}", exact: true },
  { href: "/scout/scan", label: "Area Profile", icon: "\u{1F50D}" },
  { href: "/scout/sweep", label: "Spaces Sweep", icon: "\u{1F9F9}" },
  { href: "/scout/compare", label: "Compare", icon: "\u{2696}️" },
  { href: "/scout/sites", label: "My Sites", icon: "\u{1F4CD}" },
  { href: "/scout/admin", label: "Admin", icon: "\u{1F6E0}️", adminOnly: true },
];

const SCOUT_ALL_PAGES = [
  ...SCOUT_NAV,
  { href: "/scout/report", label: "Report" },
  { href: "/scout/admin/scoring", label: "Scoring Weights" },
  { href: "/scout/admin/users", label: "Users" },
];

export default function ScoutSidebar({ user }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const toggle = () => setOpen((prev) => !prev);
    window.addEventListener("toggle-sidebar", toggle);
    return () => window.removeEventListener("toggle-sidebar", toggle);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("ccd_scout_sidebar_collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ccd_scout_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  }

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.title = "Fitoverse Site Scout";
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function openMarketing() {
    window.open("/inbox", "fitoverse-marketing");
  }

  function openCRM() {
    window.open("/crm", "fitoverse-crm");
  }

  const isAdmin = user.role === "admin";
  const navItems = SCOUT_NAV.filter((n) => !n.adminOnly || isAdmin);

  const currentLabel =
    SCOUT_ALL_PAGES.find((n) => pathname.startsWith(n.href))?.label ?? "Site Scout";

  return (
    <>
      {/* Mobile top bar */}
      <header className="font-sans lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="p-1.5 -ml-1 rounded-lg hover:bg-slate-100 transition"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-heading font-bold uppercase tracking-tight text-slate-900 truncate">{currentLabel}</div>
          <div className="mt-0.5">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wide whitespace-nowrap bg-court-500/10 text-court-700">
              <span className="w-1.5 h-1.5 rounded-full bg-court-500" />
              Site Scout
            </span>
          </div>
        </div>
        <div className="w-8 h-8 rounded bg-court-600 text-white flex items-center justify-center font-heading font-bold text-sm">
          S
        </div>
      </header>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          font-sans
          fixed lg:sticky inset-y-0 left-0 top-0 z-50 lg:z-auto
          w-64 h-screen lg:h-screen shrink-0
          app-sidebar border-r flex flex-col
          transform transition-[width,transform] duration-200 ease-out
          ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          ${collapsed ? "lg:w-[68px]" : "lg:w-60"}
        `}
      >
        <div
          className={`
            border-b border-slate-200 flex items-center
            ${collapsed ? "lg:p-3 lg:justify-center p-5 justify-between" : "p-5 justify-between"}
          `}
        >
          <div className="flex items-center gap-3 min-w-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/quotation-assets/image1.png"
              alt="Fitoverse"
              className={collapsed ? "lg:hidden h-8 w-auto" : "h-8 w-auto"}
            />
            {collapsed && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/quotation-assets/image1.png"
                alt="Fitoverse"
                className="hidden lg:block h-8 w-auto max-w-[40px] object-contain object-left"
              />
            )}
          </div>
          <button
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="lg:hidden p-1.5 -mr-1 rounded-lg hover:bg-slate-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
            className={`
              hidden lg:flex items-center justify-center p-1.5 rounded-lg
              text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition
              ${collapsed ? "absolute -right-3 top-7 bg-white border border-slate-200 shadow-sm w-6 h-6 z-10" : ""}
            `}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}
            </svg>
          </button>
        </div>

        {/* Section badge */}
        <div className="px-3 pt-3">
          <div className={collapsed ? "lg:hidden" : ""}>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wide whitespace-nowrap bg-court-500/10 text-court-700">
              <span className="w-1.5 h-1.5 rounded-full bg-court-500" />
              Site Scout
            </span>
          </div>
          {collapsed && (
            <div className="hidden lg:flex lg:justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-court-500" title="Site Scout" aria-label="Site Scout" />
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = "exact" in item && item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`relative flex items-center gap-3 rounded-lg text-sm font-medium transition ${
                  collapsed ? "lg:justify-center lg:px-2 lg:py-2.5 px-3 py-2.5" : "px-3 py-2.5"
                } ${
                  active
                    ? "bg-[var(--acs)] text-[var(--ac)]"
                    : "text-[rgb(var(--sub))] hover:bg-[rgb(var(--p2))] hover:text-[rgb(var(--tx))] active:bg-[rgb(var(--line))]"
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-[var(--ac)]"
                  />
                )}
                <span className="text-base shrink-0">{item.icon}</span>
                <span className={`flex-1 font-heading uppercase tracking-wide ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
              </Link>
            );
          })}

          <div className="my-2 border-t border-slate-200" />

          {/* Switch to WhatsApp Marketing */}
          <button
            type="button"
            onClick={openMarketing}
            title={collapsed ? "WhatsApp Marketing" : undefined}
            className={`w-full relative flex items-center gap-3 rounded-lg text-sm font-medium transition ${
              collapsed ? "lg:justify-center lg:px-2 lg:py-2.5 px-3 py-2.5" : "px-3 py-2.5"
            } text-[rgb(var(--sub))] hover:bg-[rgb(var(--p2))] hover:text-[rgb(var(--tx))] active:bg-[rgb(var(--line))]`}
          >
            <span className="text-base shrink-0">{"\u{1F4AC}"}</span>
            <span className={`flex-1 text-left font-heading uppercase tracking-wide ${collapsed ? "lg:hidden" : ""}`}>
              Marketing
            </span>
            {!collapsed && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            )}
          </button>

          {/* Switch to CRM */}
          <button
            type="button"
            onClick={openCRM}
            title={collapsed ? "CRM" : undefined}
            className={`w-full relative flex items-center gap-3 rounded-lg text-sm font-medium transition ${
              collapsed ? "lg:justify-center lg:px-2 lg:py-2.5 px-3 py-2.5" : "px-3 py-2.5"
            } text-[rgb(var(--sub))] hover:bg-[rgb(var(--p2))] hover:text-[rgb(var(--tx))] active:bg-[rgb(var(--line))]`}
          >
            <span className="text-base shrink-0">{"\u{1F9ED}"}</span>
            <span className={`flex-1 text-left font-heading uppercase tracking-wide ${collapsed ? "lg:hidden" : ""}`}>
              CRM
            </span>
            {!collapsed && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            )}
          </button>
        </nav>

        <div className={`border-t border-slate-200 ${collapsed ? "lg:p-2 p-3" : "p-3"}`}>
          <Link
            href="/scout/dashboard"
            title={collapsed ? `${user.name} (${user.role})` : undefined}
            className={`block rounded-lg transition ${
              collapsed ? "lg:px-1 lg:py-2 px-3 py-2" : "px-3 py-2"
            } hover:bg-slate-50`}
          >
            {collapsed ? (
              <>
                <div className="hidden lg:flex items-center justify-center">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-xs ${
                      user.role === "admin"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {initials(user.name)}
                  </div>
                </div>
                <div className="lg:hidden">
                  <div className="text-sm font-medium text-slate-900 truncate">{user.name}</div>
                  <div className="text-xs text-slate-500 truncate">{user.email}</div>
                  <div className="text-xs mt-0.5">
                    <span className={`badge ${user.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                      {user.role}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-slate-900 truncate">{user.name}</div>
                <div className="text-xs text-slate-500 truncate">{user.email}</div>
                <div className="text-xs mt-0.5">
                  <span className={`badge ${user.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                    {user.role}
                  </span>
                </div>
              </>
            )}
          </Link>
          <button
            onClick={logout}
            title={collapsed ? "Sign out" : undefined}
            className={`w-full text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 rounded-lg transition ${
              collapsed ? "lg:flex lg:items-center lg:justify-center lg:px-2 lg:py-2 px-3 py-2.5 text-left" : "px-3 py-2.5 text-left"
            }`}
          >
            <span className={collapsed ? "lg:inline hidden text-base" : "hidden"}>{"⏻"}</span>
            <span className={`font-heading uppercase tracking-wide ${collapsed ? "lg:hidden" : ""}`}>Sign out</span>
          </button>
          <div className={`px-1 pt-2 ${collapsed ? "lg:hidden" : ""}`}>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
