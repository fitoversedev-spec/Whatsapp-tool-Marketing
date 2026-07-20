// Validates every row against the chosen target + column mapping and
// reports per-row status — writes nothing. The step the existing Contact
// import (src/app/api/contacts/import/route.ts) skips entirely.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { extractFieldValues, validateRow, buildDedupeContext } from "@/lib/import/dedupe";

const schema = z.object({
  target: z.enum(["CONTACTS", "COMPANIES", "LEADS", "DEALS"]),
  rows: z.array(z.array(z.any())).min(1), // rows[0] = header
  columnMap: z.record(z.string(), z.string()), // fieldKey -> header name
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { target, rows, columnMap } = parsed.data;

  const headers = (rows[0] ?? []).map((h) => String(h ?? ""));
  const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));

  if (dataRows.length > 2000) {
    return NextResponse.json({ error: "Import is limited to 2000 rows at a time" }, { status: 400 });
  }

  // Built once for the whole preview call, not per row — see the perf note
  // on DedupeContext in src/lib/import/dedupe.ts.
  const context = await buildDedupeContext(target);

  const results = [];
  let validCount = 0, invalidCount = 0, duplicateCount = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const fields = extractFieldValues(headers, dataRows[i], columnMap);
    const { errors, duplicateId, duplicateLabel } = await validateRow(target, fields, context);
    const status = errors.length ? "invalid" : duplicateId ? "duplicate" : "valid";
    if (status === "invalid") invalidCount++;
    else if (status === "duplicate") duplicateCount++;
    else validCount++;
    results.push({ rowIndex: i, status, errors, duplicateId, duplicateLabel, fields });
  }

  return NextResponse.json({
    totalRows: dataRows.length,
    validCount,
    invalidCount,
    duplicateCount,
    rows: results,
  });
}
