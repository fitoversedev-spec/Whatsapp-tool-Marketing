// Writes every valid row (re-validating server-side rather than trusting
// the client's preview response), stamps each newly-created row with a
// fresh ImportBatch, and returns per-row outcomes.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractFieldValues, validateRow, commitRow, buildDedupeContext } from "@/lib/import/dedupe";

const schema = z.object({
  target: z.enum(["CONTACTS", "COMPANIES", "LEADS", "DEALS"]),
  fileName: z.string().max(200),
  rows: z.array(z.array(z.any())).min(1),
  columnMap: z.record(z.string(), z.string()),
  duplicateAction: z.enum(["skip", "update", "create"]).default("skip"),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { target, fileName, rows, columnMap, duplicateAction } = parsed.data;

  const headers = (rows[0] ?? []).map((h) => String(h ?? ""));
  const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));
  if (dataRows.length > 2000) {
    return NextResponse.json({ error: "Import is limited to 2000 rows at a time" }, { status: 400 });
  }

  const batch = await prisma.importBatch.create({
    data: {
      importedByUserId: user.id,
      target,
      fileName,
      rowCount: dataRows.length,
      successCount: 0,
      errorCount: 0,
    },
  });

  let successCount = 0, errorCount = 0, skippedCount = 0;
  const rowErrors: { rowIndex: number; errors: string[] }[] = [];

  // Built once for the whole commit call, not per row — see the perf note
  // on DedupeContext in src/lib/import/dedupe.ts. commitRow() keeps it in
  // sync as rows are created so in-batch duplicates are still caught.
  const context = await buildDedupeContext(target);

  for (let i = 0; i < dataRows.length; i++) {
    const fields = extractFieldValues(headers, dataRows[i], columnMap);
    const { errors, duplicateId } = await validateRow(target, fields, context);
    if (errors.length) {
      errorCount++;
      rowErrors.push({ rowIndex: i, errors });
      continue;
    }
    try {
      const result = await commitRow(target, fields, duplicateId, duplicateAction, user.id, batch.id, context);
      if (result === null) skippedCount++;
      else successCount++;
    } catch (err) {
      errorCount++;
      rowErrors.push({ rowIndex: i, errors: ["Could not save this row — " + (err instanceof Error ? err.message : "unknown error")] });
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { successCount, errorCount },
  });

  return NextResponse.json({
    batchId: batch.id,
    successCount,
    skippedCount,
    errorCount,
    rowErrors: rowErrors.slice(0, 50),
  });
}
