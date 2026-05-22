"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

type Props = {
  user: { name: string; email: string; role: "admin" | "sales" };
  pendingCount?: number;
};

const NAV = [
  { href: "/inbox", label: "Inbox", icon: "💬" },
  { href: "/contacts", label: "Contacts", icon: "📒" },
  { href: "/templates", label: "Templates", icon: "📝" },
  { href: "/broadcasts", label: "Broadcasts", icon: "📣" },
  { href: "/users", label: "Users", icon: "👥", adminOnly: true, badgeKey: "pending" as const },
];

export default function Sidebar({ user, pendingCount = 0 }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
            const badge = item.badgeKey === "pending" && pendingCount > 0 ? pendingCount : 0;
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
                  <span className="inline-block bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

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
        </div>
      </aside>
    </>
  );
}
