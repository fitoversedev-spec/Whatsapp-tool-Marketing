// Bulk operations against a selection of contacts. Single endpoint so the
// frontend doesn't have to juggle 4 different routes for similar shapes.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  action: z.enum(["set_tags", "set_consent", "delete"]),
  payload: z.record(z.string(), z.any()).optional().default({}),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const { ids, action, payload } = parsed.data;

  if (action === "delete" && user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  switch (action) {
    case "set_tags": {
      const tagIds = z.array(z.string().uuid()).safeParse(payload.tagIds);
      if (!tagIds.success) return NextResponse.json({ error: "tagIds required" }, { status: 400 });
      await prisma.$transaction([
        prisma.contactTag.deleteMany({ where: { contactId: { in: ids } } }),
        prisma.contactTag.createMany({
          data: ids.flatMap((cid) =>
            tagIds.data.map((tid) => ({ contactId: cid, tagId: tid }))
          ),
          skipDuplicates: true,
        }),
      ]);
      return NextResponse.json({ ok: true, affected: ids.length });
    }
    case "set_consent": {
      const allow = z.boolean().safeParse(payload.allowCampaign);
      if (!allow.success) return NextResponse.json({ error: "allowCampaign required" }, { status: 400 });
      const result = await prisma.contact.updateMany({
        where: { id: { in: ids } },
        data: { allowCampaign: allow.data },
      });
      return NextResponse.json({ ok: true, affected: result.count });
    }
    case "delete": {
      const result = await prisma.contact.deleteMany({ where: { id: { in: ids } } });
      return NextResponse.json({ ok: true, affected: result.count });
    }
  }
}
