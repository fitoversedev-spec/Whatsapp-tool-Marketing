import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSheet, colIndex } from "@/lib/sheets";
import { normalizePhone } from "@/lib/phone";

const filterRuleSchema = z.object({
  column: z.string(),
  condition: z.enum(["equals", "contains", "starts_with", "not_empty"]),
  value: z.string().optional().default(""),
});

const schema = z.object({
  sheetUrl: z.string().url().or(z.string().min(10)).optional(),
  sheetRange: z.string().min(1).optional(),
  fileRows: z.array(z.array(z.any())).optional(),
  phoneColumn: z.string(),
  countryCodeColumn: z.string().optional(),
  nameColumn: z.string().optional(),
  variableMapping: z.record(z.string(), z.string()),
  filterRules: z.array(filterRuleSchema).optional().default([]),
});

function matchesFilter(cellValue: string, rule: z.infer<typeof filterRuleSchema>): boolean {
  const cell = String(cellValue ?? "").trim().toLowerCase();
  const val = String(rule.value ?? "").trim().toLowerCase();
  switch (rule.condition) {
    case "equals": return cell === val;
    case "contains": return cell.includes(val);
    case "starts_with": return cell.startsWith(val);
    case "not_empty": return cell.length > 0;
    default: return true;
  }
}

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

  // Column resolver: by header name, then numeric index, then letter (A, B, C…)
  const getColumnIndex = (colKey: string): number => {
    if (!colKey) return -1;
    const byHeader = headers.findIndex(
      (h) => String(h).trim().toLowerCase() === colKey.trim().toLowerCase()
    );
    if (byHeader >= 0) return byHeader;
    if (/^\d+$/.test(colKey)) return parseInt(colKey, 10);
    try { return colIndex(colKey); } catch { return -1; }
  };

  const phoneIdx = getColumnIndex(parsed.data.phoneColumn);
  const countryCodeIdx = parsed.data.countryCodeColumn ? getColumnIndex(parsed.data.countryCodeColumn) : -1;
  const nameIdx = parsed.data.nameColumn ? getColumnIndex(parsed.data.nameColumn) : -1;

  const optOuts = new Set(
    (await prisma.optOut.findMany({ select: { phoneE164: true } })).map((o) => o.phoneE164)
  );

  // Resolve filter column indices once
  const activeFilters = (parsed.data.filterRules ?? []).filter((r) => r.column.trim());
  const filterIndices = activeFilters.map((r) => ({ rule: r, idx: getColumnIndex(r.column) }));

  let willSend = 0;
  let optOutsCount = 0;
  let invalid = 0;
  let filtered = 0;
  const samples: { phone: string; name?: string; preview: string }[] = [];

  for (const row of dataRows) {
    // Apply filter rules first
    if (filterIndices.length > 0) {
      const passes = filterIndices.every(({ rule, idx }) => {
        if (idx < 0) return false;
        return matchesFilter(String(row[idx] ?? ""), rule);
      });
      if (!passes) { filtered++; continue; }
    }

    // Build phone number — combine country code + phone if both provided
    let rawPhone = String(row[phoneIdx] ?? "").trim();
    if (countryCodeIdx >= 0) {
      const cc = String(row[countryCodeIdx] ?? "").replace(/\D/g, "");
      rawPhone = cc + rawPhone.replace(/\D/g, "");
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) { invalid++; continue; }
    if (optOuts.has(phone)) { optOutsCount++; continue; }

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
    filtered,
    optOuts: optOutsCount,
    invalid,
    samples,
  });
}
