import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

const schema = z.object({
  name: z.string().min(1).max(120),
});

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  await prisma.user.update({ where: { id: me.id }, data: { name: parsed.data.name } });

  // Refresh session name so sidebar updates without re-login
  const session = await getSession();
  session.name = parsed.data.name;
  await session.save();

  return NextResponse.json({ ok: true });
}
