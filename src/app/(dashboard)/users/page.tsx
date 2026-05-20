import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: [{ deletedAt: "asc" }, { approvalStatus: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      approvalStatus: true,
      rejectionReason: true,
      deletedAt: true,
      createdAt: true,
    },
  });
  return (
    <UsersClient
      currentUserId={me.id}
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role as "admin" | "sales",
        isActive: u.isActive,
        approvalStatus: u.approvalStatus as "pending" | "approved" | "rejected",
        rejectionReason: u.rejectionReason,
        deletedAt: u.deletedAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      }))}
    />
  );
}
