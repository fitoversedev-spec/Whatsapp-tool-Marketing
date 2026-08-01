import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getSession();
  const userId = session.userId;

  // Usage tracking: close the rep's open session (explicit punch-out). Best
  // effort — logout must succeed regardless.
  if (userId) {
    try {
      await prisma.userSession.updateMany({
        where: { userId, endedAt: null },
        data: { endedAt: new Date() },
      });
    } catch {
      /* ignore */
    }
  }

  session.destroy();
  return NextResponse.json({ ok: true });
}
