import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSheetId } from "@/lib/sheets";

const filterRuleSchema = z.object({
  column: z.string(),
  condition: z.enum(["equals", "contains", "starts_with", "not_empty"]),
  value: z.string().optional().default(""),
});

const schema = z.object({
  name: z.string().min(1).max(120),
  sheetUrl: z.string().min(10).optional(),
  sheetRange: z.string().min(1).optional(),
  fileData: z.string().min(2).optional(),
  templateId: z.string().uuid(),
  phoneColumn: z.string(),
  countryCodeColumn: z.string().optional(),
  nameColumn: z.string().optional(),
  variableMapping: z.record(z.string(), z.string()),
  filterRules: z.array(filterRuleSchema).optional().default([]),
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

  const sheetId = parsed.data.sheetUrl ? parseSheetId(parsed.data.sheetUrl) : null;

  const broadcast = await prisma.broadcast.create({
    data: {
      name: parsed.data.name,
      sheetId,
      sheetRange: parsed.data.sheetRange ?? null,
      fileData: parsed.data.fileData ?? null,
      templateId: parsed.data.templateId,
      variableMapping: JSON.stringify({
        phoneColumn: parsed.data.phoneColumn,
        countryCodeColumn: parsed.data.countryCodeColumn ?? null,
        nameColumn: parsed.data.nameColumn ?? null,
        variables: parsed.data.variableMapping,
        filterRules: (parsed.data.filterRules ?? []).filter((r) => r.column.trim()),
      }),
      status: "draft",
      createdByUserId: user.id,
    },
  });

  return NextResponse.json({ broadcast: { id: broadcast.id, status: broadcast.status } });
}
