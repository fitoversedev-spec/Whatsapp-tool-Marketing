import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProfileClient from "./ProfileClient";
import type { Role } from "@/lib/rbac";

export default async function ProfilePage() {
  const user = await requireUser();
  // Preferred unit + phone live on the DB row (not the session), so fetch
  // fresh for the initial render — avoids a client-side flash.
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
