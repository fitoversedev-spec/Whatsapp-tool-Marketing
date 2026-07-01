import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage() {
  const user = await requireUser();
  // Preferred unit lives on the DB row (not the session), so fetch it
  // fresh for the initial render — avoids a client-side flash.
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { preferredUnit: true },
  });
  return (
    <ProfileClient
      user={{
        name: user.name,
        email: user.email,
        role: user.role as "admin" | "sales",
        preferredUnit: (row?.preferredUnit ?? "ft") as "ft" | "m",
      }}
    />
  );
}
