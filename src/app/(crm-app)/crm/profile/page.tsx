import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProfileClient from "@/app/(dashboard)/profile/ProfileClient";
import type { Role } from "@/lib/rbac";

export default async function CrmProfilePage() {
  const user = await requireUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { preferredUnit: true, phone: true },
  });
  return (
    <ProfileClient
      user={{
        name: user.name,
        email: user.email,
        role: user.role as Role,
        preferredUnit: (row?.preferredUnit ?? "ft") as "ft" | "m",
        phone: row?.phone ?? null,
      }}
    />
  );
}
