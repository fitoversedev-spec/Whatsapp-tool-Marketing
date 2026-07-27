// Chat scoping — the mirror of resolveAnalyticsScope for the team chat. A
// non-admin only ever sees/tags records they own; admin is company-wide. Used
// by the inbox list and the @-mention record search so chip suggestions can
// never leak another rep's customers/leads/deals (Option B).
import type { Role } from "@/lib/rbac";
import { isAdmin } from "@/lib/rbac";

export type ChatScope = { userId: string; companyWide: boolean };

export function resolveChatScope(user: { id: string; role: Role }): ChatScope {
  return { userId: user.id, companyWide: isAdmin(user.role) };
}

// Prisma WHERE fragments restricting records to those a non-admin may tag/see.
// AccountContact has no owner of its own — ownership is the parent Account's.
export function contactOwnerWhere(scope: ChatScope): Record<string, unknown> {
  return scope.companyWide ? {} : { account: { ownerUserId: scope.userId } };
}
export function dealOwnerWhere(scope: ChatScope): Record<string, unknown> {
  return scope.companyWide ? {} : { ownerUserId: scope.userId };
}
