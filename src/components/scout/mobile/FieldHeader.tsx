"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { fieldNavItems, type FieldNavContext } from "./nav";

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
      <header className="flex-none z-[12] bg-[var(--black)] text-[color:var(--on-dark)] pt-[calc(12px+var(--m-safe-top))] px-[var(--m-pad-x)] pb-[15px]">
        <div className="flex justify-between items-center gap-2 text-[length:var(--text-11)] text-[color:var(--on-dark-muted-soft)] tracking-[0.04em] mb-3.5 min-w-0">
          <span className="truncate">{statusLeft}</span>
          <span className="truncate">{statusRight}</span>
        </div>

        <div className="flex items-center gap-3 min-w-0">
          {variant === "brand" ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandMark />
              <span className="font-display uppercase tracking-[0.13em] text-[length:var(--text-13)] font-bold whitespace-nowrap">Site Scout</span>
            </div>
          ) : (
            <>
              <Link href={backHref} className="relative flex-none w-8 h-8 border-0 rounded-full bg-[var(--on-dark-fill)] text-[color:var(--on-dark)] flex items-center justify-center cursor-pointer after:content-[''] after:absolute after:inset-[-6px] after:rounded-full" aria-label={backLabel}>
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
              <div className="min-w-0">
                <div className="font-display uppercase tracking-[0.11em] text-[length:var(--text-12-5)] font-bold whitespace-nowrap overflow-hidden text-ellipsis">{title}</div>
                {subtitle ? <div className="text-[length:var(--text-11)] text-[color:var(--on-dark-muted)] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">{subtitle}</div> : null}
              </div>
            </>
          )}

          <button
            type="button"
            ref={pillRef}
            className="flex items-center gap-2 ml-auto flex-none bg-[var(--on-dark-fill)] border-0 text-[color:var(--on-dark)] font-sans text-xs font-semibold py-3 px-[13px] rounded-full cursor-pointer min-h-[var(--m-touch)]"
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
              className={["transition-transform duration-[var(--dur-fast)] ease-[var(--ease-standard)]", menuOpen && "rotate-180"].filter(Boolean).join(" ")}
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        {search ? (
          <div className="flex items-center gap-[9px] bg-[var(--on-dark-fill)] rounded-[12px] py-[11px] px-[13px] mt-3.5">
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
              className="flex-1 min-w-0 border-0 outline-none bg-transparent font-sans text-[length:var(--text-13-5)] text-[color:var(--on-dark)] min-h-[22px] placeholder:text-[color:var(--on-dark-muted-soft)]"
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
            className="fixed inset-0 z-30 border-0 p-0 bg-[rgba(10,10,10,0.35)] cursor-pointer"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="fixed top-[calc(96px+var(--m-safe-top))] right-[var(--m-pad-x)] z-[31] w-[min(236px,calc(100vw-36px))] bg-[var(--surface-card)] rounded-[16px] border border-[color:var(--border-default)] shadow-lg overflow-hidden motion-reduce:!animate-none"
            style={{ animation: "ssIn 0.16s var(--ease-standard)" }}
            id={menuId}
            role="menu"
            aria-label="Go to"
          >
            <div className="pt-[11px] px-[15px] pb-[9px] text-[length:var(--text-10)] font-bold tracking-[var(--tracking-section)] uppercase text-[color:var(--m-muted)] bg-slate-100">Go to</div>
            {items.map((item) =>
              item.href ? (
                <Link
                  key={item.key}
                  href={item.href}
                  role="menuitem"
                  className={[
                    "flex items-center justify-between gap-2.5 w-full text-left border-0 border-t border-[color:var(--border-default)] py-[13px] px-[15px] min-h-[var(--m-touch)] font-sans text-[length:var(--text-13-5)] text-ink cursor-pointer no-underline [&:first-of-type]:border-t-0",
                    item.key === activeKey ? "bg-blue-100 font-bold" : "bg-[var(--surface-card)] font-medium",
                  ].join(" ")}
                >
                  <span>{item.label}</span>
                  <span className="text-[length:var(--text-11)] text-[color:var(--m-muted)] flex-none">{item.hint}</span>
                </Link>
              ) : (
                <span
                  key={item.key}
                  role="menuitem"
                  aria-disabled="true"
                  className="flex items-center justify-between gap-2.5 w-full text-left bg-[var(--surface-card)] border-0 border-t border-[color:var(--border-default)] py-[13px] px-[15px] min-h-[var(--m-touch)] font-sans text-[length:var(--text-13-5)] font-medium text-[color:var(--m-muted)] cursor-not-allowed opacity-60 [&:first-of-type]:border-t-0"
                >
                  <span>{item.label}</span>
                  <span className="text-[length:var(--text-11)] text-[color:var(--m-muted)] flex-none">{item.hint}</span>
                </span>
              ),
            )}
            <form action="/api/scout/auth/signout" method="post">
              <button type="submit" role="menuitem" className="flex items-center justify-between gap-2.5 w-full text-left bg-[var(--surface-card)] border-0 border-t border-[color:var(--border-default)] py-[13px] px-[15px] min-h-[var(--m-touch)] font-sans text-[length:var(--text-13-5)] font-medium text-ink cursor-pointer no-underline [&:first-of-type]:border-t-0">
                <span>Sign out</span>
                <span className="text-[length:var(--text-11)] text-[color:var(--m-muted)] flex-none" />
              </button>
            </form>
          </div>
        </>
      ) : null}
    </>
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
