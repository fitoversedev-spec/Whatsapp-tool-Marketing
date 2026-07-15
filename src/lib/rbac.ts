// Shared role type + helpers for the CRM build. User.role stays a plain
// String column (see prisma/schema.prisma header) — this is the single
// place the 4-value union is declared, so widening it later doesn't mean
// hunting down every inline "admin"|"sales" cast.
//
// Only ~27 of the ~124 role-check sites in this codebase do real
// ownership-scoping (role !== "admin" ? {} : { createdByUserId: user.id });
// the rest are legitimate admin-only gates that don't need these helpers.
// Adopt these in new CRM code (Deals/Leads) from Phase 1 onward, and in the
// existing ownership-scoped CRM-adjacent files as they're touched — not a
// blanket retrofit of every admin-only gate in the app.

export type Role = "admin" | "sales" | "manager" | "management";

export function isAdmin(role: string): boolean {
  return role === "admin";
}

// Manager and above: admin or manager (office-scoped management access).
export function isManagerOrAbove(role: string): boolean {
  return role === "admin" || role === "manager";
}

// Management and above: admin or management (company-wide read access).
export function isManagementOrAbove(role: string): boolean {
  return role === "admin" || role === "management";
}
