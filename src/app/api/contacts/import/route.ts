import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone, combinePhone, parseBool } from "@/lib/phone";
import { colIndex } from "@/lib/sheets";
import { parseFields } from "@/lib/contacts";

// Bulk import. Client parses the xlsx/csv and posts rows + a column mapping.
const schema = z.object({
  rows: z.array(z.array(z.any())).min(1), // rows[0] = header
  phoneColumn: z.string(),
  countryCodeColumn: z.string().optional(),
  nameColumn: z.string().optional(),
  allowCampaignColumn: z.string().optional(),
  fieldColumns: z.record(z.string(), z.string()).optional().default({}),
});

function resolveIndex(headers: string[], key: string): number {
  if (!key) return -1;
  const byHeader = headers.findIndex(
    (h) => String(h).trim().toLowerCase() === key.trim().toLowerCase()
  );
  if (byHeader >= 0) return byHeader;
  if (/^\d+$/.test(key)) return parseInt(key, 10);
  try {
    return colIndex(key);
  } catch {
    return -1;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const headers = (parsed.data.rows[0] ?? []).map((h) => String(h ?? ""));
  const dataRows = parsed.data.rows.slice(1);

  const phoneIdx = resolveIndex(headers, parsed.data.phoneColumn);
  const ccIdx = parsed.data.countryCodeColumn
    ? resolveIndex(headers, parsed.data.countryCodeColumn)
    : -1;
  const nameIdx = parsed.data.nameColumn ? resolveIndex(headers, parsed.data.nameColumn) : -1;
  const allowIdx = parsed.data.allowCampaignColumn
    ? resolveIndex(headers, parsed.data.allowCampaignColumn)
    : -1;

  const fieldMap: { label: string; idx: number }[] = [];
  for (const [label, col] of Object.entries(parsed.data.fieldColumns ?? {})) {
    const idx = resolveIndex(headers, col);
    if (idx >= 0) fieldMap.push({ label, idx });
  }

  if (phoneIdx < 0) {
    return NextResponse.json({ error: "Phone column could not be resolved" }, { status: 400 });
  }

  const existing = await prisma.contact.findMany({
    select: { id: true, phone: true, fields: true },
  });
  const existingByPhone = new Map(existing.map((c) => [c.phone, c]));

  let added = 0;
  let updated = 0;
  let invalid = 0;
  let blocked = 0; // imported but AllowCampaign=false

  for (const row of dataRows) {
    let rawPhone = String(row[phoneIdx] ?? "").trim();
    if (ccIdx >= 0) {
      rawPhone = combinePhone(String(row[ccIdx] ?? ""), rawPhone);
    }
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      invalid++;
      continue;
    }

    const name = nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "";
    const allowCampaign = allowIdx >= 0 ? parseBool(row[allowIdx], true) : true;
    if (!allowCampaign) blocked++;

    const fields: Record<string, string> = {};
    for (const fm of fieldMap) {
      fields[fm.label] = String(row[fm.idx] ?? "").trim();
    }

    const found = existingByPhone.get(phone);
    if (found) {
      const merged = { ...parseFields(found.fields), ...fields };
      await prisma.contact.update({
        where: { id: found.id },
        data: { name: name || undefined, allowCampaign, fields: JSON.stringify(merged) },
      });
      updated++;
    } else {
      await prisma.contact.create({
        data: { phone, name: name || null, allowCampaign, fields: JSON.stringify(fields) },
      });
      existingByPhone.set(phone, { id: "new", phone, fields: JSON.stringify(fields) });
      added++;
    }
  }

  const total = await prisma.contact.count();

  return NextResponse.json({ added, updated, invalid, blocked, totalInPool: total });
}
