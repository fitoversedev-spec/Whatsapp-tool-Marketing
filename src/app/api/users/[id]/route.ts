import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({ isActive: z.boolean().optional() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (me.id === params.id) return NextResponse.json({ error: "Cannot modify yourself" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  await prisma.user.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}
