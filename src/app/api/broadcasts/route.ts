import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createBroadcastRecord } from "@/lib/broadcasts/create";

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
  // When sourceType=contacts and set, the recipients are this broadcast
  // group's members, read when the broadcast sends (filter rules and picked
  // contacts are ignored). Persisted in the variableMapping blob too.
  groupId: z.string().uuid().optional(),
  // ISO timestamp. When present and in the future, broadcast is saved in
  // "scheduled" status and waits for the cron sweep to launch it.
  scheduledAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  // Template, source, group and schedule checks live in createBroadcastRecord,
  // shared with the AI agent's draft_broadcast.
  const result = await createBroadcastRecord({ ...parsed.data, createdByUserId: user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ broadcast: result.broadcast });
}
