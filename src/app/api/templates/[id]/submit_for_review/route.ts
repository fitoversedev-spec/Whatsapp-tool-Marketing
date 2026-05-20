import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tpl = await prisma.template.findUnique({ where: { id: params.id } });
  if (!tpl) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (tpl.status !== "draft") {
    return NextResponse.json({ error: "Only draft templates can be submitted for review" }, { status: 422 });
  }
  if (user.role !== "admin" && tpl.draftedByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.template.update({
    where: { id: tpl.id },
    data: { status: "pending_admin" },
  });

  return NextResponse.json({ ok: true });
}
