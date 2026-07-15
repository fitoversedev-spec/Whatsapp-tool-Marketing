"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { setFaviconBadge } from "@/lib/favicon";
import ThemeToggle from "./ThemeToggle";
import AllToolsPanel from "./AllToolsPanel";
import type { Role } from "@/lib/rbac";

type Props = {
  user: { name: string; email: string; role: Role };
  pendingCount?: number;
  unreadCount?: number;
  reminderCount?: number;
  tokenExpired?: boolean;
};

// Primary nav — the 6 most-used items, always visible in the sidebar.
// Everything else lives in the All Tools popover (see AllToolsPanel.tsx
// for the full categorized list).
const PRIMARY_NAV = [
  { href: "/search", label: "Search", icon: "🔍" },
  { href: "/inbox", label: "Inbox", icon: "💬", badgeKey: "unread" as const },
  { href: "/contacts", label: "Contacts", icon: "📒" },
  { href: "/broadcasts", label: "Broadcasts", icon: "📣" },
  { href: "/reminders", label: "Reminders", icon: "⏰", badgeKey: "reminders" as const },
  { href: "/pipeline", label: "Pipeline", icon: "🎯" },
  { href: "/deals", label: "Deals", icon: "📁" },
  { href: "/leads", label: "Bot leads", icon: "🤖" },
];

export default function Sidebar({
  user,
  pendingCount = 0,
  unreadCount: unreadInitial = 0,
  reminderCount: reminderInitial = 0,
  tokenExpired = false,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(unreadInitial);
  const [reminderCount, setReminderCount] = useState(reminderInitial);
  const [allToolsOpen, setAllToolsOpen] = useState(false);
  // Collapsed sidebar (desktop only — mobile already uses a drawer).
  // Persisted in localStorage so the user's preference survives reloads.
  // Default expanded; flips to collapsed only after we read storage on mount
  // to avoid a flicker for users who prefer collapsed.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("ccd_sidebar_collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ccd_sidebar_collapsed", String(next));
      } catch {
        /* localStorage might be blocked — ignore */
      }
      // Force-close the All Tools popover when collapsing; expanded the
      // popover anchors off the right edge of the sidebar and would be
      // misaligned for the first paint after collapse.
      if (next) setAllToolsOpen(false);
      return next;
    });
  }

  // Close drawer + All Tools panel on route change
  useEffect(() => {
    setOpen(false);
    setAllToolsOpen(false);
  }, [pathname]);

  // Live-poll unread + reminder counts every 15s. Pauses when tab is hidden.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/unread/count");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setUnreadCount(data.unread ?? 0);
        setReminderCount(data.reminders ?? 0);
      } catch {
        // ignore transient network errors
      }
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

  // Sync browser tab title + favicon when unread count changes.
  useEffect(() => {
    const baseTitle = "WhatsApp Tool";
    if (unreadCount > 0) {
      document.title = `(${unreadCount > 99 ? "99+" : unreadCount}) ${baseTitle}`;
      setFaviconBadge(true);
    } else {
      document.title = baseTitle;
      setFaviconBadge(false);
    }
  }, [unreadCount]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  // Primary nav is shown directly in the sidebar; "All Tools" reveals the rest.
  // For the mobile top-bar title we want to find the current page across BOTH
  // primary and all-tools, so the title stays meaningful even when the user
  // is on a less-frequent page (e.g. Templates) reached via All Tools.
  const ALL_PAGES = [
    ...PRIMARY_NAV,
    { href: "/templates", label: "Templates" },
    { href: "/tags", label: "Tags" },
    { href: "/quotations", label: "Quotations" },
    { href: "/court-images", label: "Court Designer" },
    { href: "/products", label: "Products" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/analytics", label: "Analytics" },
    { href: "/team", label: "Team Performance" },
    { href: "/media", label: "Media library" },
    { href: "/settings/quotation-rates", label: "Quotation rates" },
    { href: "/connection", label: "Connection" },
    { href: "/users", label: "Users" },
    { href: "/admin/taxonomies", label: "Taxonomies" },
    { href: "/admin/audit-log", label: "Audit log" },
  ];
  const currentLabel =
    ALL_PAGES.find((n) => pathname.startsWith(n.href))?.label ?? "WhatsApp Tool";

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
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
          <div className="font-semibold text-slate-900 truncate">{currentLabel}</div>
        </div>
        <div className="w-8 h-8 rounded-lg bg-wa-green text-white flex items-center justify-center font-bold text-sm">
          W
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
          fixed lg:sticky inset-y-0 left-0 top-0 z-50 lg:z-auto
          w-64 h-screen lg:h-screen shrink-0
          bg-white border-r border-slate-200 flex flex-col
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
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-wa-green text-white flex items-center justify-center font-bold shrink-0">
              W
            </div>
            <div className={collapsed ? "lg:hidden" : ""}>
              <div className="font-semibold text-slate-900 leading-tight">WhatsApp</div>
              <div className="text-xs text-slate-500">Marketing Tool</div>
            </div>
          </div>
          {/* Mobile close button */}
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
          {/* Desktop collapse toggle — chevron flips based on state */}
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

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {PRIMARY_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const badge =
              item.badgeKey === "unread"
                ? unreadCount
                : item.badgeKey === "reminders"
                  ? reminderCount
                  : 0;
            const badgeColor =
              item.badgeKey === "unread" ? "bg-red-500" : "bg-orange-500";
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`relative flex items-center gap-3 rounded-lg text-sm font-medium transition ${
                  collapsed ? "lg:justify-center lg:px-2 lg:py-2.5 px-3 py-2.5" : "px-3 py-2.5"
                } ${
                  active
                    ? "bg-wa-green/10 text-wa-dark"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100"
                }`}
              >
                <span className="text-base shrink-0 relative">
                  {item.icon}
                  {/* When collapsed, badge becomes a small dot overlay on the icon */}
                  {collapsed && badge > 0 && (
                    <span
                      className={`hidden lg:block absolute -top-1 -right-1 ${badgeColor} w-2.5 h-2.5 rounded-full ring-2 ring-white`}
                      aria-label={`${badge} pending`}
                    />
                  )}
                </span>
                <span className={`flex-1 ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                {!collapsed && badge > 0 && (
                  <span
                    className={`inline-block ${badgeColor} text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {/* Mobile drawer always shows badge as bubble (mobile never collapses) */}
                {collapsed && badge > 0 && (
                  <span
                    className={`lg:hidden inline-block ${badgeColor} text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none ml-auto`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}

          {/* Divider before All Tools */}
          <div className="my-2 border-t border-slate-200" />

          {/* All Tools trigger — opens the categorized popover */}
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
              🔲
              {collapsed && pendingCount > 0 && user.role === "admin" && (
                <span className="hidden lg:block absolute -top-1 -right-1 bg-amber-500 w-2.5 h-2.5 rounded-full ring-2 ring-white" />
              )}
            </span>
            <span className={`flex-1 text-left ${collapsed ? "lg:hidden" : ""}`}>All Tools</span>
            {!collapsed && pendingCount > 0 && user.role === "admin" && (
              <span className="inline-block bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none">
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
        </nav>

        {/* Token expiry warning — visible to admin on all pages.
            When collapsed, render as a tiny lock icon so the user is still
            alerted without breaking the slim layout. */}
        {tokenExpired && (
          <Link
            href="/connection"
            title={collapsed ? "Token expired — click to fix" : undefined}
            className={`mx-3 mb-2 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition ${
              collapsed ? "lg:justify-center lg:px-2 lg:py-2 px-3 py-2.5" : "px-3 py-2.5"
            }`}
          >
            <span className="text-base shrink-0">🔑</span>
            <div className={collapsed ? "lg:hidden" : ""}>
              <div className="text-xs font-bold text-red-800 leading-tight">Token Expired</div>
              <div className="text-[10px] text-red-700 mt-0.5 leading-tight">Messages cannot be sent. Click to fix →</div>
            </div>
          </Link>
        )}

        <div className={`border-t border-slate-200 ${collapsed ? "lg:p-2 p-3" : "p-3"}`}>
          <Link
            href="/profile"
            title={collapsed ? `${user.name} (${user.role})` : undefined}
            className={`block rounded-lg transition ${
              collapsed ? "lg:px-1 lg:py-2 px-3 py-2" : "px-3 py-2"
            } ${
              pathname.startsWith("/profile") ? "bg-slate-100" : "hover:bg-slate-50"
            }`}
          >
            {collapsed ? (
              <>
                {/* Collapsed: just initials avatar centered */}
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
                {/* Mobile drawer keeps the full block */}
                <div className="lg:hidden">
                  <div className="text-sm font-medium text-slate-900 truncate">{user.name}</div>
                  <div className="text-xs text-slate-500 truncate">{user.email}</div>
                  <div className="text-xs mt-0.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                        user.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                      }`}
                    >
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
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                      user.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                    }`}
                  >
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
            <span className={collapsed ? "lg:inline hidden text-base" : "hidden"}>⏻</span>
            <span className={collapsed ? "lg:hidden" : ""}>Sign out</span>
          </button>
          {/* Theme toggle — hide on collapsed desktop to save vertical space */}
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
        anchorOffset={collapsed ? 76 : 252}
      />
    </>
  );
}

// First letter of first + last name (e.g. "Vignesh Manikandan" → "VM").
// Single-word names just use the first character.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
