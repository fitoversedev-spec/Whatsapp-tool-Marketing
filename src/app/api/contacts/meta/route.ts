import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";

// Returns the distinct field keys across all contacts, plus distinct values per key.
// Powers the filter UI on the Contacts page and the broadcast composer.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contacts = await prisma.contact.findMany({ select: { fields: true } });

  const valuesByKey = new Map<string, Set<string>>();
  for (const c of contacts) {
    const fields = parseFields(c.fields);
    for (const [k, v] of Object.entries(fields)) {
      if (!valuesByKey.has(k)) valuesByKey.set(k, new Set());
      if (v && String(v).trim()) valuesByKey.get(k)!.add(String(v).trim());
    }
  }

  const fields = Array.from(valuesByKey.entries())
    .map(([key, values]) => ({
      key,
      values: Array.from(values).sort().slice(0, 200), // cap for UI
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return NextResponse.json({ fields, totalContacts: contacts.length });
}
