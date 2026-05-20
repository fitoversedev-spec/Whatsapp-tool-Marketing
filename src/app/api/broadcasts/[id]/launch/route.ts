import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runBroadcast } from "@/lib/sender";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await prisma.broadcast.findUnique({ where: { id: params.id } });
  if (!b) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && b.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (b.status !== "draft") return NextResponse.json({ error: `Already ${b.status}` }, { status: 422 });

  // Fire-and-forget; the worker will mark progress on the broadcast row
  runBroadcast(params.id).catch(async (err) => {
    console.error("[broadcast]", params.id, err);
    await prisma.broadcast.update({ where: { id: params.id }, data: { status: "failed" } });
  });

  return NextResponse.json({ ok: true, status: "launching" }, { status: 202 });
}
