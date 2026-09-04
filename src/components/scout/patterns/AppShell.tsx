"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { NAV_ITEMS, isActive } from "@/lib/scout/nav";

/**
 * What the shell needs to draw its chrome.
 *
 * `name` and `email` are display only. The admin nav item and the status-row
 * label are driven by a *permission* rather than a role string, because the
 * host application this tool is ported into names its roles differently — see
 * `src/lib/identity/types.ts`.
 */
export interface AppShellUser {
  name: string;
  email: string;
  /** Shows the Admin nav item and labels the mobile status row. */
  canEditScoringWeights: boolean;
}

export interface AppShellProps {
  user: AppShellUser;
  /** Right-hand note in the desktop nav ("Bengaluru desk · 12 saved scans"). */
  deskNote?: string;
  /** Left-hand note in the mobile status row ("Field mode · Bengaluru"). */
  fieldNote?: string;
  children: ReactNode;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

export function AppShell({
  user,
  deskNote = "Bengaluru desk",
  fieldNote = "Field mode · Bengaluru",
  children,
}: AppShellProps) {
  const pathname = usePathname() ?? "";
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV_ITEMS.filter((n) => !n.adminOnly || user.canEditScoringWeights);

  // Close the sheet on navigation and on Escape.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh flex flex-col bg-slate-50 font-sans text-slate-900 min-[901px]:h-dvh min-[901px]:overflow-hidden">
      {/* ---------- Desktop top nav ---------- */}
      <header className="flex-none h-16 bg-black text-white flex items-center gap-9 px-7 max-[900px]:hidden">
        <div className="flex items-center gap-[11px] flex-none">
          <BrandMark />
          <span className="font-display uppercase tracking-[0.13em] text-[13px] font-bold">
            Site Scout
          </span>
          <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[#73caf0] border border-[rgba(115,202,240,0.4)] py-[2px] px-[7px] rounded-[4px]">
            Internal
          </span>
        </div>
        <nav className="flex items-center gap-1" aria-label="Primary">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={[
                "font-sans text-[13px] font-medium py-[9px] px-[15px] rounded-[9px] border-0 cursor-pointer transition-colors duration-150 ease-in-out bg-transparent text-white/70 no-underline hover:bg-white/10 hover:text-white",
                isActive(pathname, n.href) && "font-semibold bg-white/15 text-white",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive(pathname, n.href) ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3.5">
          <span className="text-xs text-white/55">{deskNote}</span>
          <form action="/api/scout/auth/signout" method="post">
            <button
              type="submit"
              className="bg-transparent border-0 text-white/55 text-xs font-sans cursor-pointer p-1 hover:text-white"
            >
              Sign out
            </button>
          </form>
          <span
            className="w-8 h-8 rounded-full bg-[#1a2744] text-white flex items-center justify-center text-xs font-bold flex-none"
            title={`${user.name} · ${user.email}`}
          >
            {initials(user.name)}
          </span>
        </div>
      </header>

      {/* ---------- Mobile header + Menu sheet ---------- */}
      <header className="flex-none bg-black text-white pt-3 px-[18px] pb-3.5 hidden max-[900px]:block">
        <div className="flex justify-between items-center text-[11px] text-white/40 tracking-[0.04em] mb-3.5">
          <span>{user.canEditScoringWeights ? "Admin" : "Sales"}</span>
          <span>{fieldNote}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-[11px] flex-none">
            <BrandMark />
            <span className="font-display uppercase tracking-[0.13em] text-[13px] font-bold">
              Site Scout
            </span>
          </div>
          <button
            type="button"
            className="flex items-center gap-2 bg-white/10 border-0 text-white font-sans text-xs font-semibold py-2 px-[13px] rounded-full cursor-pointer"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            Menu
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-150 ease-in-out ${menuOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </header>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 bg-black/35 border-0 p-0 cursor-default"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="fixed top-24 right-[18px] z-[21] w-[236px] bg-white rounded-[16px] border shadow-[0_18px_40px_rgba(0,0,0,0.22)] overflow-hidden animate-[ssIn_0.16s_ease] motion-reduce:animate-none"
            role="menu"
            aria-label="Go to"
          >
            <div className="pt-[11px] px-[15px] pb-[9px] text-[10px] font-bold tracking-[0.13em] uppercase text-slate-500 bg-slate-100">
              Go to
            </div>
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                role="menuitem"
                className={[
                  "flex items-center justify-between gap-2.5 w-full text-left bg-white border-0 border-t py-[13px] px-[15px] font-sans text-[13.5px] font-medium text-slate-900 cursor-pointer no-underline first-of-type:border-t-0",
                  isActive(pathname, n.href) && "bg-court-100 font-bold",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span>{n.mobileLabel}</span>
                <span className="text-[11px] text-slate-500">{n.hint}</span>
              </Link>
            ))}
            <form action="/api/scout/auth/signout" method="post">
              <button
                type="submit"
                role="menuitem"
                className="flex items-center justify-between gap-2.5 w-full text-left bg-white border-0 border-t py-[13px] px-[15px] font-sans text-[13.5px] font-medium text-slate-900 cursor-pointer no-underline"
              >
                <span>Sign out</span>
                <span className="text-[11px] text-slate-500">{user.email}</span>
              </button>
            </form>
          </div>
        </>
      ) : null}

      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
    </div>
  );
}

/** The host's Fitoverse logo, at the same 26x26 footprint the gradient placeholder used. */
function BrandMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="w-[26px] h-[26px] flex-none"
      src="/quotation-assets/image1.png"
      alt="Fitoverse"
      width={26}
      height={26}
    />
  );
}
