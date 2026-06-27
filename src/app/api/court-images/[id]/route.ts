// Get / update / delete a single court image. Update lets the wizard
// re-save after the user edits a draft — layout JSON, imageUrl, caption,
// and contact fields can all change. We refuse to update once the design
// has been sent so the audit trail stays accurate; instead the UI clones
// it to a new draft.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const layoutSchema = z
  .object({
    v: z.literal(1),
    plot: z.object({ lengthFt: z.number(), widthFt: z.number() }),
    sports: z.array(z.string()),
    elements: z.array(z.record(z.string(), z.any())),
    style: z.record(z.string(), z.any()),
    title: z.string().optional(),
  })
  .passthrough();

const updateSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  layout: layoutSchema.optional(),
  imageUrl: z.string().url().nullable().optional(),
  caption: z.string().max(1024).nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  contactPhone: z.string().min(5).max(30).nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const row = await prisma.courtImage.findUnique({
    where: { id: params.id },
    include: { createdBy: { select: { name: true } } },
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && row.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let layout: unknown;
  try {
    layout = JSON.parse(row.layout);
  } catch {
    layout = null;
  }

  return NextResponse.json({
    courtImage: {
      id: row.id,
      number: row.number,
      customerName: row.customerName,
      layout,
      imageUrl: row.imageUrl,
      caption: row.caption,
      status: row.status,
      conversationId: row.conversationId,
      contactPhone: row.contactPhone,
      sentAt: row.sentAt?.toISOString() ?? null,
      createdByName: row.createdBy.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const row = await prisma.courtImage.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && row.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (row.status === "sent") {
    return NextResponse.json(
      { error: "already_sent", message: "This design was already sent. Clone it to make changes." },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.courtImage.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.customerName !== undefined && { customerName: parsed.data.customerName }),
      ...(parsed.data.layout !== undefined && { layout: JSON.stringify(parsed.data.layout) }),
      ...(parsed.data.imageUrl !== undefined && { imageUrl: parsed.data.imageUrl }),
      ...(parsed.data.caption !== undefined && { caption: parsed.data.caption }),
      ...(parsed.data.conversationId !== undefined && { conversationId: parsed.data.conversationId }),
      ...(parsed.data.contactPhone !== undefined && { contactPhone: parsed.data.contactPhone }),
    },
  });

  return NextResponse.json({
    courtImage: { id: updated.id, number: updated.number, status: updated.status },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const row = await prisma.courtImage.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && row.createdByUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (row.status === "sent") {
    return NextResponse.json(
      { error: "already_sent", message: "Sent designs cannot be deleted." },
      { status: 409 }
    );
  }

  await prisma.courtImage.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
