"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { NAV_ITEMS, isActive } from "@/lib/scout/nav";
import styles from "./AppShell.module.css";

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
    <div className={styles.shell}>
      <header className={styles.topnav}>
        <div className={styles.brand}>
          <BrandMark />
          <span className={styles.wordmark}>Site Scout</span>
          <span className={styles.internal}>Internal</span>
        </div>
        <nav className={styles.navlist} aria-label="Primary">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={[styles.navlink, isActive(pathname, n.href) && styles.navlinkActive]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive(pathname, n.href) ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className={styles.navRight}>
          <span className={styles.deskNote}>{deskNote}</span>
          <form action="/api/scout/auth/signout" method="post">
            <button type="submit" className={styles.signout}>
              Sign out
            </button>
          </form>
          <span className={styles.avatar} title={`${user.name} · ${user.email}`}>
            {initials(user.name)}
          </span>
        </div>
      </header>

      <header className={styles.mobileHeader}>
        <div className={styles.statusRow}>
          <span>{user.canEditScoringWeights ? "Admin" : "Sales"}</span>
          <span>{fieldNote}</span>
        </div>
        <div className={styles.mobileBar}>
          <div className={styles.brand}>
            <BrandMark />
            <span className={styles.wordmark}>Site Scout</span>
          </div>
          <button
            type="button"
            className={styles.menuPill}
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
              className={[styles.caret, menuOpen && styles.caretOpen].filter(Boolean).join(" ")}
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
            className={styles.scrim}
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className={styles.sheet} role="menu" aria-label="Go to">
            <div className={styles.sheetHeading}>Go to</div>
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                role="menuitem"
                className={[
                  styles.sheetItem,
                  isActive(pathname, n.href) && styles.sheetItemActive,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span>{n.mobileLabel}</span>
                <span className={styles.sheetHint}>{n.hint}</span>
              </Link>
            ))}
            <form action="/api/scout/auth/signout" method="post">
              <button type="submit" role="menuitem" className={styles.sheetItem}>
                <span>Sign out</span>
                <span className={styles.sheetHint}>{user.email}</span>
              </button>
            </form>
          </div>
        </>
      ) : null}

      <main className={styles.main}>{children}</main>
    </div>
  );
}

/**
 * The mockups load `assets/logo-mark.png`, which is not in this repo. Until the
 * real mark is supplied this draws the brand ribbon gradient in a rounded
 * square at the same 26x26 footprint, so layout is unaffected.
 */
function BrandMark() {
  return (
    <svg
      className={styles.mark}
      viewBox="0 0 26 26"
      role="img"
      aria-label="Fitoverse"
      focusable="false"
    >
      <defs>
        <linearGradient id="ss-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--green)" />
          <stop offset="45%" stopColor="var(--sky)" />
          <stop offset="80%" stopColor="var(--navy)" />
          <stop offset="100%" stopColor="var(--red)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="26" height="26" rx="7" fill="url(#ss-mark)" />
    </svg>
  );
}
