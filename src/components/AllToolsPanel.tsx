"use client";

// Meta-style "All Tools" popover. Triggered from the sidebar's All Tools
// button. Lists less-frequently-used pages grouped by category, each
// rendered as a clickable card with icon + name + one-line description.
//
// Positioning:
//   Desktop: absolute popover anchored to the right edge of the sidebar
//   Mobile: full-width sheet inside the sidebar drawer (which is already
//   covering the screen)
//
// Close behavior: click outside, press Esc, or click any tool card (which
// navigates away).

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/rbac";
import { isManagementOrAbove } from "@/lib/rbac";

export type AllToolsItem = {
  href: string;
  label: string;
  icon: string;
  description: string;
  adminOnly?: boolean;
  // Visible to management as well as admin (narrower than the default
  // "everyone" but broader than adminOnly) — e.g. the audit log, which
  // spec §13 grants to MANAGEMENT + ADMIN, not just ADMIN.
  managementOrAbove?: boolean;
};

export type AllToolsGroup = {
  title: string;
  items: AllToolsItem[];
};

export const ALL_TOOLS_GROUPS: AllToolsGroup[] = [
  {
    title: "Marketing & Sales",
    items: [
      {
        href: "/templates",
        label: "Templates",
        icon: "📝",
        description: "Manage WhatsApp message templates",
      },
      {
        href: "/quotations",
        label: "Quotations",
        icon: "📄",
        description: "Generate and track customer quotes",
      },
      {
        href: "/court-images",
        label: "Court Designer",
        icon: "🎨",
        description: "Draw editable 2D layouts, send as WhatsApp image",
      },
      {
        href: "/products",
        label: "Products",
        icon: "📦",
        description: "Floorings, materials, equipment + TDS sheets per sport",
      },
      {
        href: "/portfolio",
        label: "Portfolio",
        icon: "📘",
        description: "Past Fitoverse builds + per-sport catalogue PDFs",
      },
      {
        href: "/analytics",
        label: "Broadcast Analytics",
        icon: "📊",
        description: "Broadcast performance and delivery insights",
      },
      {
        href: "/media",
        label: "Media library",
        icon: "📎",
        description: "All uploaded images, videos, and files",
      },
    ],
  },
  {
    title: "Organization",
    items: [
      {
        href: "/tags",
        label: "Tags",
        icon: "🏷️",
        description: "Color-coded contact labels",
      },
      {
        href: "/settings/quotation-rates",
        label: "Quotation rates",
        icon: "⚙️",
        description: "Default rate sheets per sport",
        adminOnly: true,
      },
    ],
  },
  {
    title: "CRM",
    items: [
      {
        href: "/crm",
        label: "CRM dashboard",
        icon: "🧭",
        description: "My Day for sales reps, team snapshot for admins",
      },
      {
        href: "/crm/contacts",
        label: "Contacts",
        icon: "🧑",
        description: "People at a company — separate from the WhatsApp broadcast list",
      },
      {
        href: "/crm/leads",
        label: "Leads",
        icon: "🎯",
        description: "Promoted leads — the ones being actively worked toward a deal",
      },
      {
        href: "/crm/companies",
        label: "Customer types",
        icon: "🏢",
        description: "Contacts grouped by customer type, business type, lead source, or city",
      },
      {
        href: "/deals",
        label: "Deals",
        icon: "📁",
        description: "Every sales opportunity, across every channel",
      },
      {
        href: "/crm/activities",
        label: "Activities",
        icon: "🗒️",
        description: "Every logged touchpoint and reminder, in one place",
      },
      {
        href: "/crm/import",
        label: "Import",
        icon: "📤",
        description: "Bulk-load contacts, companies, leads, or deals from a spreadsheet",
      },
      {
        href: "/crm/analytics",
        label: "CRM analytics",
        icon: "📈",
        description: "Individual and team performance, best sellers, platform performance",
        adminOnly: true,
      },
      {
        href: "/crm/settings",
        label: "CRM settings",
        icon: "⚙️",
        description: "Taxonomies, users, and audit log — gathered in one place",
        adminOnly: true,
      },
    ],
  },
  {
    title: "Admin",
    items: [
      {
        href: "/connection",
        label: "Connection",
        icon: "🔌",
        description: "Meta API status and token health",
        adminOnly: true,
      },
      {
        href: "/users",
        label: "Users",
        icon: "👥",
        description: "Team members and approval queue",
        adminOnly: true,
      },
      {
        href: "/admin/taxonomies",
        label: "Taxonomies",
        icon: "🏷️",
        description: "Funnel stages, lead sources, customer profiles, and other editable lists",
        adminOnly: true,
      },
      {
        href: "/admin/targets",
        label: "Targets",
        icon: "🎯",
        description: "Set company-wide or per-rep revenue targets by month, quarter, or FY",
        adminOnly: true,
      },
      {
        href: "/admin/audit-log",
        label: "Audit log",
        icon: "🧾",
        description: "Every stage change, role change, and taxonomy edit — who did what, when",
        managementOrAbove: true,
      },
    ],
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
  userRole: Role;
  pendingCount: number;
  // Pixel offset from the left edge of the viewport for desktop anchoring.
  // Tracks the current sidebar width (252 expanded, 76 collapsed) so the
  // popover stays flush against the sidebar regardless of collapsed state.
  anchorOffset?: number;
};

export default function AllToolsPanel({
  open,
  onClose,
  userRole,
  pendingCount,
  anchorOffset = 260,
}: Props) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Only close if the click isn't on the trigger button itself.
        const target = e.target as HTMLElement;
        if (!target.closest("[data-all-tools-trigger]")) {
          onClose();
        }
      }
    }
    // Defer to allow the click that opened the panel to complete
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop — covers the rest of the sidebar drawer area */}
      <div
        className="lg:hidden fixed inset-0 bg-black/50 z-[55]"
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        style={{
          // Apply desktop left-anchor inline so it follows the live
          // collapsed/expanded sidebar width — Tailwind arbitrary classes
          // are static, but this needs to be dynamic per render.
          ["--all-tools-left" as never]: `${anchorOffset}px`,
        }}
        className={`
          fixed z-[60] bg-white shadow-2xl border border-slate-200
          inset-x-4 top-20 bottom-4 max-h-[80vh] overflow-y-auto rounded-2xl
          lg:inset-auto lg:top-4 lg:bottom-4 lg:left-[var(--all-tools-left)] lg:w-[520px] lg:max-h-[calc(100vh-2rem)]
        `}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="font-semibold text-slate-900">All Tools</h2>
            <p className="text-xs text-slate-500">Less-frequent tools, grouped</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close all tools"
            className="p-1.5 rounded-md hover:bg-slate-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Groups */}
        <div className="p-5 space-y-6">
          {ALL_TOOLS_GROUPS.map((group) => {
            const visible = group.items.filter(
              (i) =>
                (!i.adminOnly || userRole === "admin") &&
                (!i.managementOrAbove || isManagementOrAbove(userRole))
            );
            if (visible.length === 0) return null;
            return (
              <section key={group.title}>
                <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {group.title}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {visible.map((item) => {
                    const active = pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={`relative flex items-start gap-3 p-3 rounded-lg border transition ${
                          active
                            ? "border-wa-green bg-wa-green/5 text-wa-dark"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <span className="text-xl shrink-0">{item.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-tight flex items-center gap-1.5">
                            {item.label}
                            {item.href === "/users" && pendingCount > 0 && (
                              <span className="inline-block bg-amber-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                                {pendingCount}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                            {item.description}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
