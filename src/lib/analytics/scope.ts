// The single chokepoint every analytics API route calls FIRST to decide
// whose deals a request can see. Non-admin is always forced to their own
// ownerId — never overridable by anything a client sends (a query param, a
// request body field, etc.) — so per-route scoping bugs can't leak other
// reps' numbers. Admin gets company-wide (ownerIds undefined = unrestricted).
import type { Role } from "@/lib/rbac";
import { isAdmin } from "@/lib/rbac";

export type AnalyticsScope = { ownerIds?: string[]; companyWide: boolean };

export function resolveAnalyticsScope(user: { id: string; role: Role }): AnalyticsScope {
  if (isAdmin(user.role)) return { companyWide: true };
  return { ownerIds: [user.id], companyWide: false };
}
