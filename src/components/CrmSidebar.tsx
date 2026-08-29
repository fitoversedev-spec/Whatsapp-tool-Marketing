"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import ThemeToggle from "./ThemeToggle";
import AllToolsPanel from "./AllToolsPanel";
import type { AllToolsGroup } from "./AllToolsPanel";
import type { Role } from "@/lib/rbac";

type Props = {
  user: { name: string; email: string; role: Role };
  pendingCount?: number;
  reminderCount?: number;
};

const CRM_PRIMARY_NAV = [
  { href: "/crm", label: "Dashboard", icon: "\u{1F9ED}", exact: true },
  { href: "/crm/contacts", label: "Contacts", icon: "\u{1F9D1}" },
  { href: "/crm/leads", label: "Leads", icon: "\u{1F3AF}" },
  { href: "/deals", label: "Deals", icon: "\u{1F4C1}" },
  { href: "/pipeline", label: "Pipeline", icon: "\u{1F3D7}️" },
  { href: "/crm/reminders", label: "Reminders", icon: "⏰", badgeKey: "reminders" as const },
  { href: "/crm/quotations", label: "Quotations", icon: "\u{1F4C4}" },
  { href: "/crm/court-images", label: "Court Designer", icon: "\u{1F3A8}" },
  { href: "/crm/activities", label: "Activities", icon: "\u{1F5D2}️" },
];

const CRM_ALL_TOOLS_GROUPS: AllToolsGroup[] = [
  {
    title: "CRM",
    items: [
      { href: "/crm/companies", label: "Customer segments", icon: "\u{1F3E2}", description: "Contacts grouped by customer segment, business type, lead source, or city" },
      { href: "/crm/invoices", label: "Invoices", icon: "\u{1F9FE}", description: "Convert confirmed quotes to invoices; track payments" },
      { href: "/crm/import", label: "Import", icon: "\u{1F4E4}", description: "Bulk-load contacts, companies, leads, or deals from a spreadsheet" },
      { href: "/crm/analytics", label: "CRM Analytics", icon: "\u{1F4C8}", description: "Individual and team performance, best sellers, platform performance" },
      { href: "/crm/settings", label: "CRM Settings", icon: "⚙️", description: "Taxonomies, users, and audit log gathered in one place", adminOnly: true },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/crm/connection", label: "Connection", icon: "\u{1F50C}", description: "Meta API status and token health", adminOnly: true },
      { href: "/crm/users", label: "Users", icon: "\u{1F465}", description: "Team members and approval queue", adminOnly: true },
      { href: "/crm/admin/ai-usage", label: "AI usage", icon: "✨", description: "Who's using AI, request counts, and estimated spend", adminOnly: true },
      { href: "/crm/admin/taxonomies", label: "Taxonomies", icon: "\u{1F3F7}️", description: "Funnel stages, lead sources, customer profiles, and other editable lists", adminOnly: true },
      { href: "/crm/admin/targets", label: "Targets", icon: "\u{1F3AF}", description: "Set company-wide or per-rep revenue targets by month, quarter, or FY", adminOnly: true },
      { href: "/crm/admin/audit-log", label: "Audit log", icon: "\u{1F9FE}", description: "Every stage change, role change, and taxonomy edit", managementOrAbove: true },
    ],
  },
];

const CRM_ALL_PAGES = [
  ...CRM_PRIMARY_NAV,
  { href: "/crm/companies", label: "Customer segments" },
  { href: "/crm/invoices", label: "Invoices" },
  { href: "/crm/import", label: "Import" },
  { href: "/crm/analytics", label: "CRM Analytics" },
  { href: "/crm/settings", label: "CRM Settings" },
  { href: "/crm/connection", label: "Connection" },
  { href: "/crm/users", label: "Users" },
  { href: "/crm/admin/ai-usage", label: "AI usage" },
  { href: "/crm/admin/taxonomies", label: "Taxonomies" },
  { href: "/crm/admin/targets", label: "Targets" },
  { href: "/crm/admin/audit-log", label: "Audit log" },
  { href: "/crm/profile", label: "Profile" },
];

export default function CrmSidebar({
  user,
  pendingCount = 0,
  reminderCount: reminderInitial = 0,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reminderCount, setReminderCount] = useState(reminderInitial);
  const [allToolsOpen, setAllToolsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("ccd_crm_sidebar_collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ccd_crm_sidebar_collapsed", String(next));
      } catch {}
      if (next) setAllToolsOpen(false);
      return next;
    });
  }

  useEffect(() => {
    setOpen(false);
    setAllToolsOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/crm-app/badge-count");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setReminderCount(data.reminders ?? 0);
      } catch {}
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    document.title = "Fitoverse CRM";
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function openMarketing() {
    window.open("/inbox", "fitoverse-marketing");
  }

  const currentLabel =
    CRM_ALL_PAGES.find((n) => pathname.startsWith(n.href))?.label ?? "Fitoverse CRM";

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
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wide whitespace-nowrap bg-turf-500/10 text-turf-700">
              <span className="w-1.5 h-1.5 rounded-full bg-turf-500" />
              Fitoverse CRM
            </span>
          </div>
        </div>
        <div className="w-8 h-8 rounded bg-turf-600 text-white flex items-center justify-center font-heading font-bold text-sm">
          C
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

        {/* Static CRM badge */}
        <div className="px-3 pt-3">
          <div className={collapsed ? "lg:hidden" : ""}>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wide whitespace-nowrap bg-turf-500/10 text-turf-700">
              <span className="w-1.5 h-1.5 rounded-full bg-turf-500" />
              Fitoverse CRM
            </span>
          </div>
          {collapsed && (
            <div className="hidden lg:flex lg:justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-turf-500" title="Fitoverse CRM" aria-label="Fitoverse CRM" />
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {CRM_PRIMARY_NAV.map((item) => {
            const active = "exact" in item && item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            const badge = item.badgeKey === "reminders" ? reminderCount : 0;
            const badgeColor = "bg-orange-500";
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
                <span className="text-base shrink-0 relative">
                  {item.icon}
                  {collapsed && badge > 0 && (
                    <span
                      className={`hidden lg:block absolute -top-1 -right-1 ${badgeColor} w-2.5 h-2.5 rounded-full ring-2 ring-white`}
                      aria-label={`${badge} pending`}
                    />
                  )}
                </span>
                <span className={`flex-1 font-heading uppercase tracking-wide ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                {!collapsed && badge > 0 && (
                  <span
                    className={`inline-block ${badgeColor} text-white text-[10px] font-bold font-mono rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {collapsed && badge > 0 && (
                  <span
                    className={`lg:hidden inline-block ${badgeColor} text-white text-[10px] font-bold font-mono rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none ml-auto`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}

          <div className="my-2 border-t border-slate-200" />

          <button
            type="button"
            data-all-tools-trigger
            title={collapsed ? "All Tools" : undefined}
            onClick={() => setAllToolsOpen((v) => !v)}
            className={`w-full relative flex items-center gap-3 rounded-lg text-sm font-medium transition ${
              collapsed ? "lg:justify-center lg:px-2 lg:py-2.5 px-3 py-2.5" : "px-3 py-2.5"
            } ${
              allToolsOpen
                ? "bg-wa-green/10 text-wa-dark"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100"
            }`}
          >
            <span className="text-base shrink-0 relative">
              {"\u{1F532}"}
              {collapsed && pendingCount > 0 && user.role === "admin" && (
                <span className="hidden lg:block absolute -top-1 -right-1 bg-amber-500 w-2.5 h-2.5 rounded-full ring-2 ring-white" />
              )}
            </span>
            <span className={`flex-1 text-left font-heading uppercase tracking-wide ${collapsed ? "lg:hidden" : ""}`}>All Tools</span>
            {!collapsed && pendingCount > 0 && user.role === "admin" && (
              <span className="inline-block bg-amber-500 text-white text-[10px] font-bold font-mono rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none">
                {pendingCount}
              </span>
            )}
            {!collapsed && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${allToolsOpen ? "rotate-90" : ""}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
          </button>

          <div className="my-2 border-t border-slate-200" />

          {/* Switch to WhatsApp Marketing */}
          <button
            type="button"
            onClick={openMarketing}
            title={collapsed ? "WhatsApp Marketing" : undefined}
            className={`w-full relative flex items-center gap-3 rounded-lg text-sm font-medium transition ${
              collapsed ? "lg:justify-center lg:px-2 lg:py-2.5 px-3 py-2.5" : "px-3 py-2.5"
            } text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100`}
          >
            <span className="text-base shrink-0">{"\u{1F4AC}"}</span>
            <span className={`flex-1 text-left font-heading uppercase tracking-wide ${collapsed ? "lg:hidden" : ""}`}>
              WhatsApp Marketing
            </span>
            {!collapsed && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            )}
          </button>
        </nav>

        <div className={`border-t border-slate-200 ${collapsed ? "lg:p-2 p-3" : "p-3"}`}>
          <Link
            href="/crm/profile"
            title={collapsed ? `${user.name} (${user.role})` : undefined}
            className={`block rounded-lg transition ${
              collapsed ? "lg:px-1 lg:py-2 px-3 py-2" : "px-3 py-2"
            } ${
              pathname.startsWith("/crm/profile") ? "bg-slate-100" : "hover:bg-slate-50"
            }`}
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

      <AllToolsPanel
        open={allToolsOpen}
        onClose={() => setAllToolsOpen(false)}
        userRole={user.role}
        pendingCount={pendingCount}
        groups={CRM_ALL_TOOLS_GROUPS}
        anchorOffset={collapsed ? 76 : 252}
      />
    </>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
