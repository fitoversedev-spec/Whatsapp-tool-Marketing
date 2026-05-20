import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import UsersClient from "./UsersClient";

export default async function UsersPage() {
  await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
  });
  return (
    <UsersClient
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt.toISOString(),
      }))}
    />
  );
}
