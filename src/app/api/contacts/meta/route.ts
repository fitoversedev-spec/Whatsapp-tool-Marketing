import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { distinctFieldKeys } from "@/lib/contacts-query";

// Returns the distinct field keys across all contacts and the pool size.
// Powers the filter UI on the Contacts page and the broadcast composer; both
// callers only read `fields[].key` and `totalContacts` (the per-key `values`
// list that used to be here was never used, and cost a scan of every contact).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [keys, totalContacts] = await Promise.all([distinctFieldKeys(), prisma.contact.count()]);

  const fields = keys.sort((a, b) => a.localeCompare(b)).map((key) => ({ key }));

  return NextResponse.json({ fields, totalContacts });
}
