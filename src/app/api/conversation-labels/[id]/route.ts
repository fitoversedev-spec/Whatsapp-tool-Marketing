import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  name: z.string().min(1).max(40).trim().optional(),
  color: z
    .enum(["slate", "red", "orange", "amber", "emerald", "blue", "purple", "pink"])
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  try {
    const updated = await prisma.conversationLabel.update({
      where: { id: params.id },
      data: parsed.data,
    });
    return NextResponse.json({ label: updated });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Label with that name already exists" }, { status: 409 });
    }
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await prisma.conversationLabel.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
