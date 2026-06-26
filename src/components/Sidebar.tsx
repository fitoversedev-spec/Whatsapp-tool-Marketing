"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { setFaviconBadge } from "@/lib/favicon";
import ThemeToggle from "./ThemeToggle";

type Props = {
  user: { name: string; email: string; role: "admin" | "sales" };
  pendingCount?: number;
  unreadCount?: number;
  reminderCount?: number;
  tokenExpired?: boolean;
};

const NAV = [
  { href: "/inbox", label: "Inbox", icon: "💬", badgeKey: "unread" as const },
  { href: "/search", label: "Search", icon: "🔍" },
  { href: "/contacts", label: "Contacts", icon: "📒" },
  { href: "/tags", label: "Tags", icon: "🏷️" },
  { href: "/templates", label: "Templates", icon: "📝" },
  { href: "/broadcasts", label: "Broadcasts", icon: "📣" },
  { href: "/pipeline", label: "Pipeline", icon: "🎯" },
  { href: "/analytics", label: "Analytics", icon: "📊" },
  { href: "/quotations", label: "Quotations", icon: "📄" },
  { href: "/media", label: "Media", icon: "📎" },
  { href: "/reminders", label: "Reminders", icon: "⏰", badgeKey: "reminders" as const },
  { href: "/connection", label: "Connection", icon: "🔌", adminOnly: true },
  { href: "/users", label: "Users", icon: "👥", adminOnly: true, badgeKey: "pending" as const },
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

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
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

  const navItems = NAV.filter((item) => !item.adminOnly || user.role === "admin");
  const currentLabel = navItems.find((n) => pathname.startsWith(n.href))?.label ?? "WhatsApp Tool";

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
          w-64 lg:w-60 h-screen lg:h-screen shrink-0
          bg-white border-r border-slate-200 flex flex-col
          transform transition-transform duration-200 ease-out
          ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-wa-green text-white flex items-center justify-center font-bold">
              W
            </div>
            <div>
              <div className="font-semibold text-slate-900 leading-tight">WhatsApp</div>
              <div className="text-xs text-slate-500">Marketing Tool</div>
            </div>
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
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const badge =
              item.badgeKey === "pending"
                ? pendingCount
                : item.badgeKey === "unread"
                  ? unreadCount
                  : item.badgeKey === "reminders"
                    ? reminderCount
                    : 0;
            const badgeColor =
              item.badgeKey === "unread"
                ? "bg-red-500"
                : item.badgeKey === "reminders"
                  ? "bg-orange-500"
                  : "bg-amber-500";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  active
                    ? "bg-wa-green/10 text-wa-dark"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span
                    className={`inline-block ${badgeColor} text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Token expiry warning — visible to admin on all pages */}
        {tokenExpired && (
          <Link
            href="/connection"
            className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 hover:bg-red-100 transition"
          >
            <span className="text-base shrink-0">🔑</span>
            <div>
              <div className="text-xs font-bold text-red-800 leading-tight">Token Expired</div>
              <div className="text-[10px] text-red-700 mt-0.5 leading-tight">Messages cannot be sent. Click to fix →</div>
            </div>
          </Link>
        )}

        <div className="p-3 border-t border-slate-200">
          <Link
            href="/profile"
            className={`block px-3 py-2 rounded-lg transition ${
              pathname.startsWith("/profile") ? "bg-slate-100" : "hover:bg-slate-50"
            }`}
          >
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
          </Link>
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 rounded-lg transition"
          >
            Sign out
          </button>
          <div className="px-1 pt-2">
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
