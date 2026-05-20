import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSheet, colIndex } from "@/lib/sheets";
import { normalizePhone } from "@/lib/phone";

const schema = z.object({
  sheetUrl: z.string().url().or(z.string().min(10)).optional(),
  sheetRange: z.string().min(1).optional(),
  fileRows: z.array(z.array(z.any())).optional(),
  phoneColumn: z.string(),
  nameColumn: z.string().optional(),
  variableMapping: z.record(z.string(), z.string()),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  let headers: string[] = [];
  let dataRows: any[][];

  if (parsed.data.fileRows) {
    headers = (parsed.data.fileRows[0] || []) as string[];
    dataRows = parsed.data.fileRows.slice(1);
  } else if (parsed.data.sheetUrl && parsed.data.sheetRange) {
    try {
      dataRows = await readSheet({ sheetUrlOrId: parsed.data.sheetUrl, range: parsed.data.sheetRange });
    } catch (err: any) {
      return NextResponse.json({ error: `Sheet read failed: ${err.message ?? "unknown"}` }, { status: 502 });
    }
  } else {
    return NextResponse.json({ error: "missing_data_source" }, { status: 400 });
  }

  const getColumnIndex = (colKey: string): number => {
    if (!colKey) return -1;
    const idx = headers.findIndex(
      (h) => String(h).trim().toLowerCase() === colKey.trim().toLowerCase()
    );
    if (idx >= 0) return idx;
    if (/^\d+$/.test(colKey)) {
      return parseInt(colKey, 10);
    }
    try {
      return colIndex(colKey);
    } catch {
      return -1;
    }
  };

  const phoneIdx = getColumnIndex(parsed.data.phoneColumn);
  const nameIdx = parsed.data.nameColumn ? getColumnIndex(parsed.data.nameColumn) : -1;

  const optOuts = new Set(
    (await prisma.optOut.findMany({ select: { phoneE164: true } })).map((o) => o.phoneE164)
  );

  let willSend = 0;
  let optOutsCount = 0;
  let invalid = 0;
  const samples: { phone: string; name?: string; preview: string }[] = [];

  for (const row of dataRows) {
    const rawPhone = row[phoneIdx];
    const phone = normalizePhone(String(rawPhone ?? ""));
    if (!phone) {
      invalid++;
      continue;
    }
    if (optOuts.has(phone)) {
      optOutsCount++;
      continue;
    }
    willSend++;
    if (samples.length < 5) {
      const name = nameIdx >= 0 ? String(row[nameIdx] ?? "") : "";
      const varPreview: string[] = [];
      for (const [k, col] of Object.entries(parsed.data.variableMapping)) {
        varPreview.push(`{{${k}}}=${row[getColumnIndex(col)] ?? ""}`);
      }
      samples.push({ phone, name, preview: varPreview.join(", ") });
    }
  }

  return NextResponse.json({
    totalRows: dataRows.length,
    willSend,
    optOuts: optOutsCount,
    invalid,
    samples,
  });
}
