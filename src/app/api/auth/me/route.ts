import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  // Fetch fresh preferredUnit — it isn't stored on the session so a
  // profile update takes effect immediately without re-login.
  const full = await prisma.user.findUnique({
    where: { id: user.id },
    select: { preferredUnit: true },
  });
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      preferredUnit: (full?.preferredUnit ?? "ft") as "ft" | "m",
    },
  });
}
