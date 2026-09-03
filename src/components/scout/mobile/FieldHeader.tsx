"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { fieldNavItems, type FieldNavContext } from "./nav";
import styles from "./FieldHeader.module.css";

export interface FieldHeaderProps {
  /** Left-hand status text. The mockup prints the clock; we print the state. */
  statusLeft: ReactNode;
  /** Right-hand status text ("Field mode · Bengaluru", "Scan complete"). */
  statusRight: ReactNode;
  /** Screen 01 shows the brand mark; every other screen shows a back button. */
  variant?: "brand" | "back";
  /** Back-button destination. Rendered as a link so long-press works. */
  backHref?: string;
  backLabel?: string;
  /** Big uppercase title on the `back` variant. */
  title?: string;
  /** Small line under the title ("2 km radius · 3 categories"). */
  subtitle?: string;
  /** Which menu row is highlighted. */
  activeKey?: string;
  navContext?: FieldNavContext;
  /** Optional search field, as on screen 05. */
  search?: {
    value: string;
    placeholder: string;
    label: string;
    onChange: (value: string) => void;
  };
}

/**
 * The dark Field-mode header.
 *
 * One component for all five screens because the mockup draws one header with
 * two arrangements — brand + Menu on screen 01, back + title + Menu everywhere
 * else — and splitting it would let the two drift apart in padding, which is
 * the thing you notice when you swipe between them.
 */
export function FieldHeader({
  statusLeft,
  statusRight,
  variant = "back",
  backHref = "/scout/m/scan",
  backLabel = "Back",
  title,
  subtitle,
  activeKey,
  navContext,
  search,
}: FieldHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const items = fieldNavItems(navContext);
  const pathname = usePathname();

  /**
   * Close on arrival, not on click.
   *
   * Closing the sheet inside a row's own `onClick` unmounts the `<Link>` in the
   * same commit that starts its navigation, and the navigation is dropped —
   * the sheet shuts and the screen does not change. Watching the pathname
   * instead means the sheet closes exactly when the new screen is there.
   */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        pillRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.statusRow}>
          <span>{statusLeft}</span>
          <span>{statusRight}</span>
        </div>

        <div className={styles.bar}>
          {variant === "brand" ? (
            <div className={styles.brand}>
              <BrandMark />
              <span className={styles.wordmark}>Site Scout</span>
            </div>
          ) : (
            <>
              <Link href={backHref} className={styles.back} aria-label={backLabel}>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Link>
              <div className={styles.title}>
                <div className={styles.titleText}>{title}</div>
                {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
              </div>
            </>
          )}

          <button
            type="button"
            ref={pillRef}
            className={styles.menuPill}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls={menuId}
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

        {search ? (
          <div className={styles.search}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.6"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              className={styles.searchInput}
              type="search"
              aria-label={search.label}
              placeholder={search.placeholder}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
            />
          </div>
        ) : null}
      </header>

      {menuOpen ? (
        <>
          <button
            type="button"
            className={styles.scrim}
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className={styles.sheet} id={menuId} role="menu" aria-label="Go to">
            <div className={styles.sheetHeading}>Go to</div>
            {items.map((item) =>
              item.href ? (
                <Link
                  key={item.key}
                  href={item.href}
                  role="menuitem"
                  className={[
                    styles.sheetItem,
                    item.key === activeKey && styles.sheetItemActive,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span>{item.label}</span>
                  <span className={styles.sheetHint}>{item.hint}</span>
                </Link>
              ) : (
                <span
                  key={item.key}
                  role="menuitem"
                  aria-disabled="true"
                  className={[styles.sheetItem, styles.sheetItemDisabled].join(" ")}
                >
                  <span>{item.label}</span>
                  <span className={styles.sheetHint}>{item.hint}</span>
                </span>
              ),
            )}
            <form action="/api/scout/auth/signout" method="post">
              <button type="submit" role="menuitem" className={styles.sheetItem}>
                <span>Sign out</span>
                <span className={styles.sheetHint} />
              </button>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}

/**
 * The mockup loads `assets/logo-mark.png`, which is not in this repository
 * (client requirement B5). Until the real mark arrives this draws the brand
 * ribbon gradient at the same 26×26 footprint, exactly as `AppShell` does, so
 * the two shells stay visually consistent and swapping in the PNG is a
 * one-component change.
 */
function BrandMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 26 26" role="img" aria-label="Fitoverse">
      <defs>
        <linearGradient id="ss-field-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--green)" />
          <stop offset="45%" stopColor="var(--sky)" />
          <stop offset="80%" stopColor="var(--navy)" />
          <stop offset="100%" stopColor="var(--red)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="26" height="26" rx="7" fill="url(#ss-field-mark)" />
    </svg>
  );
}
