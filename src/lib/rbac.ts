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

export type Role = "admin" | "sales" | "manager" | "management" | "ai_agent";

// "ai_agent" is the non-human service identity behind the Fitoverse AI Sales
// Agent. It exists so CRM rows can point at an owner; it is NEVER a login role:
// getCurrentUser() returns null for it, the sign-in / reset routes refuse it, and
// none of the helpers below grant it anything (they all compare against explicit
// role names, so a new role gets no access by default). Keep it that way.
export const AGENT_ROLE = "ai_agent" as const;

export function isAgentRole(role: string | null | undefined): boolean {
  return role === AGENT_ROLE;
}

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

// CRM customers (contacts, leads, companies, deals): who sees every rep's
// customers, and who can edit any of them and reassign the rep handling them.
// Management gets the company-wide view but stays read-only on customers that
// aren't theirs; sales only ever sees their own (plus unowned ones).
export function canSeeAllCustomers(role: string): boolean {
  return role === "admin" || role === "manager" || role === "management";
}

export function canManageAllCustomers(role: string): boolean {
  return role === "admin" || role === "manager";
}

// Access to one customer record owned by ownerUserId (null = unowned, which
// every rep may work on).
export function customerAccess(
  user: { id: string; role: string },
  ownerUserId: string | null,
): { canView: boolean; canEdit: boolean } {
  const own = !ownerUserId || ownerUserId === user.id;
  return {
    canView: own || canSeeAllCustomers(user.role),
    canEdit: own || canManageAllCustomers(user.role),
  };
}
