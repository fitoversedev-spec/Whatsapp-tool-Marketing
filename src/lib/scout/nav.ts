/**
 * Navigation model. The mockups drive both shells from a single `screen`
 * string; here that becomes the route. Labels are taken verbatim from
 * `design/Site Scout Desktop.dc.html` and `design/SiteScoutPhone.dc.html`.
 */
export interface NavItem {
  href: string;
  /** Desktop top-nav label (D1–D5). */
  label: string;
  /** Mobile Menu-sheet label — the phone mockup names some screens differently. */
  mobileLabel: string;
  /** Secondary text shown on the right of the mobile menu row. */
  hint?: string;
  /** Restricts the item to admins. */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/scout/dashboard", label: "Dashboard", mobileLabel: "Dashboard", hint: "" },
  { href: "/scout/scan", label: "Area profile", mobileLabel: "Site check", hint: "Current" },
  { href: "/scout/sweep", label: "Spaces sweep", mobileLabel: "Spaces sweep", hint: "" },
  { href: "/scout/compare", label: "Compare", mobileLabel: "Compare", hint: "" },
  { href: "/scout/sites", label: "My sites", mobileLabel: "My sites", hint: "Saved" },
  { href: "/scout/admin", label: "Admin", mobileLabel: "Admin", hint: "", adminOnly: true },
];

/** True when `pathname` is `href` or a child of it. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
