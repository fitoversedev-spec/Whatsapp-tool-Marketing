import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSheetId } from "@/lib/sheets";

const schema = z.object({
  name: z.string().min(1).max(120),
  sheetUrl: z.string().min(10),
  sheetRange: z.string().min(1),
  templateId: z.string().uuid(),
  phoneColumn: z.string(),
  nameColumn: z.string().optional(),
  variableMapping: z.record(z.string(), z.string()),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const template = await prisma.template.findUnique({ where: { id: parsed.data.templateId } });
  if (!template || template.status !== "approved") {
    return NextResponse.json({ error: "Template must be approved" }, { status: 422 });
  }

  const sheetId = parseSheetId(parsed.data.sheetUrl);

  const broadcast = await prisma.broadcast.create({
    data: {
      name: parsed.data.name,
      sheetId,
      sheetRange: parsed.data.sheetRange,
      templateId: parsed.data.templateId,
      variableMapping: JSON.stringify({
        phoneColumn: parsed.data.phoneColumn,
        nameColumn: parsed.data.nameColumn ?? null,
        variables: parsed.data.variableMapping,
      }),
      status: "draft",
      createdByUserId: user.id,
    },
  });

  return NextResponse.json({ broadcast: { id: broadcast.id, status: broadcast.status } });
}
