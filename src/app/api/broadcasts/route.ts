import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSheetId } from "@/lib/sheets";

const filterRuleSchema = z.object({
  column: z.string().optional(),
  field: z.string().optional(),
  condition: z.enum(["equals", "contains", "starts_with", "not_empty"]),
  value: z.string().optional().default(""),
});

const schema = z.object({
  name: z.string().min(1).max(120),
  sourceType: z.enum(["file", "sheet", "contacts"]).default("file"),
  sheetUrl: z.string().min(10).optional(),
  sheetRange: z.string().min(1).optional(),
  fileData: z.string().min(2).optional(),
  templateId: z.string().uuid(),
  phoneColumn: z.string().optional(),
  countryCodeColumn: z.string().optional(),
  nameColumn: z.string().optional(),
  variableMapping: z.record(z.string(), z.string()),
  filterRules: z.array(filterRuleSchema).optional().default([]),
  // When sourceType=contacts and this array is non-empty, the recipients
  // are the picked contacts (filter rules ignored). Persisted inside the
  // variableMapping JSON blob so sender.ts can read it back.
  selectedContactIds: z.array(z.string().uuid()).optional(),
  // ISO timestamp. When present and in the future, broadcast is saved in
  // "scheduled" status and waits for the cron sweep to launch it.
  scheduledAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const template = await prisma.template.findUnique({ where: { id: parsed.data.templateId } });
  if (!template || template.status !== "approved" || template.deletedAt) {
    return NextResponse.json({ error: "Template must be approved and active" }, { status: 422 });
  }

  const { sourceType } = parsed.data;

  // Validate the source has what it needs
  if (sourceType === "file" && !parsed.data.fileData) {
    return NextResponse.json({ error: "File data is required" }, { status: 400 });
  }
  if (sourceType === "sheet" && (!parsed.data.sheetUrl || !parsed.data.sheetRange)) {
    return NextResponse.json({ error: "Sheet URL and range are required" }, { status: 400 });
  }

  const sheetId = parsed.data.sheetUrl ? parseSheetId(parsed.data.sheetUrl) : null;

  // Schedule validation. Must be at least 2 minutes in the future to avoid
  // race with the immediate-launch path; capped at 90 days out.
  let scheduledAt: Date | null = null;
  if (parsed.data.scheduledAt) {
    const candidate = new Date(parsed.data.scheduledAt);
    const minFuture = new Date(Date.now() + 2 * 60 * 1000);
    const maxFuture = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    if (candidate < minFuture) {
      return NextResponse.json(
        { error: "Scheduled time must be at least 2 minutes in the future" },
        { status: 422 }
      );
    }
    if (candidate > maxFuture) {
      return NextResponse.json(
        { error: "Scheduled time must be within 90 days" },
        { status: 422 }
      );
    }
    scheduledAt = candidate;
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      name: parsed.data.name,
      sourceType,
      sheetId,
      sheetRange: parsed.data.sheetRange ?? null,
      fileData: parsed.data.fileData ?? null,
      templateId: parsed.data.templateId,
      variableMapping: JSON.stringify({
        phoneColumn: parsed.data.phoneColumn ?? null,
        countryCodeColumn: parsed.data.countryCodeColumn ?? null,
        nameColumn: parsed.data.nameColumn ?? null,
        variables: parsed.data.variableMapping,
        filterRules: (parsed.data.filterRules ?? []).filter((r) => (r.column || r.field || "").trim()),
        selectedContactIds: parsed.data.selectedContactIds ?? null,
      }),
      status: scheduledAt ? "scheduled" : "draft",
      scheduledAt,
      createdByUserId: user.id,
    },
  });

  return NextResponse.json({
    broadcast: {
      id: broadcast.id,
      status: broadcast.status,
      scheduledAt: broadcast.scheduledAt?.toISOString() ?? null,
    },
  });
}
