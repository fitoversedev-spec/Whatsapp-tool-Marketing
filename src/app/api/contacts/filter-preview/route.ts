import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields, contactPassesFilters, ContactFilterRule } from "@/lib/contacts";

const ruleSchema = z.object({
  field: z.string(),
  condition: z.enum(["equals", "contains", "starts_with", "not_empty"]),
  value: z.string().optional().default(""),
});

const schema = z.object({
  filterRules: z.array(ruleSchema).optional().default([]),
  variableMapping: z.record(z.string(), z.string()).optional().default({}),
  // When provided, skips filterRules and previews only these contact IDs.
  // Used by the "Pick specific" mode in the composer.
  selectedContactIds: z.array(z.string().uuid()).optional(),
});

// Previews how many saved contacts a broadcast would reach given filter rules.
// Enforces the AllowCampaign consent gate — non-consenting contacts are excluded.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const rules = (parsed.data.filterRules ?? []).filter((r) => r.field?.trim()) as ContactFilterRule[];
  const selectedIds = parsed.data.selectedContactIds ?? null;

  const contacts = selectedIds
    ? await prisma.contact.findMany({ where: { id: { in: selectedIds } } })
    : await prisma.contact.findMany();
  const optOuts = new Set(
    (await prisma.optOut.findMany({ select: { phoneE164: true } })).map((o) => o.phoneE164)
  );

  let willSend = 0;
  let filtered = 0;
  let optOutsCount = 0;
  let noConsent = 0;
  const samples: { phone: string; name?: string; preview: string }[] = [];

  for (const c of contacts) {
    const fields = parseFields(c.fields);
    // Selected-ID mode bypasses filter rules — the user already hand-
    // picked these contacts, don't reject them for missing a field.
    if (!selectedIds && !contactPassesFilters({ name: c.name, fields }, rules)) {
      filtered++;
      continue;
    }
    // Consent gate
    if (!c.allowCampaign) {
      noConsent++;
      continue;
    }
    if (optOuts.has(c.phone)) {
      optOutsCount++;
      continue;
    }
    willSend++;
    if (samples.length < 5) {
      const varPreview: string[] = [];
      for (const [k, fieldName] of Object.entries(parsed.data.variableMapping ?? {})) {
        const v = fieldName.toLowerCase() === "name" ? c.name ?? "" : fields[fieldName] ?? "";
        varPreview.push(`{{${k}}}=${v}`);
      }
      samples.push({ phone: c.phone, name: c.name ?? "", preview: varPreview.join(", ") });
    }
  }

  return NextResponse.json({
    totalContacts: contacts.length,
    willSend,
    filtered,
    optOuts: optOutsCount,
    noConsent,
    invalid: 0,
    samples,
  });
}
