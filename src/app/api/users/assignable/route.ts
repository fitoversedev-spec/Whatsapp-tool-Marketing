import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Returns the list of users that a conversation can be assigned to.
// Used by the inbox reassign dropdown (admin only).
export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      approvalStatus: "approved",
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, role: true, email: true },
  });

  return NextResponse.json({ users });
}
