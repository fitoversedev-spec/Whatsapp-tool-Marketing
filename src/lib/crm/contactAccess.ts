// Shared access check for the routes nested under one contact
// (/api/account-contacts/[id]/...): the contact must exist and the user must be
// allowed to view it, or to edit it for writes — see customerAccess().
import { prisma } from "@/lib/prisma";
import { customerAccess } from "@/lib/rbac";

export async function loadContactForUser(id: string, user: { id: string; role: string }, need: "view" | "edit") {
  const contact = await prisma.accountContact.findUnique({
    where: { id },
    select: { id: true, name: true, accountId: true, deletedAt: true, account: { select: { name: true, ownerUserId: true } } },
  });
  if (!contact || contact.deletedAt) return { error: "not_found" as const, status: 404 };
  const access = customerAccess(user, contact.account.ownerUserId);
  if (need === "view" ? !access.canView : !access.canEdit) return { error: "forbidden" as const, status: 403 };
  return { contact };
}
