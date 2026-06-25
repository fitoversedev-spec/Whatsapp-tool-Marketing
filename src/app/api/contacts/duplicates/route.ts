// Returns groups of likely-duplicate contacts. We canonicalize phone numbers
// (strip +, spaces, dashes, dots, parentheses) and group; any group with 2+
// rows is a candidate. Same-phone duplicates can sneak in when an import has
// inconsistent formatting before normalization landed.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function canonicalize(phone: string): string {
  // Keep only digits; drop leading zero(s) and country code lookalikes are
  // out of scope for v1 (assumes data is already E.164 from earlier import
  // hardening).
  return phone.replace(/[^0-9]/g, "").replace(/^0+/, "");
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const all = await prisma.contact.findMany({
    select: {
      id: true,
      phone: true,
      name: true,
      allowCampaign: true,
      createdAt: true,
      _count: { select: { tags: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by canonical phone
  const groups = new Map<string, typeof all>();
  for (const c of all) {
    const key = canonicalize(c.phone);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  // Only keep groups with at least 2 contacts
  const dupGroups = Array.from(groups.entries())
    .filter(([, items]) => items.length >= 2)
    .map(([key, items]) => ({
      canonicalPhone: key,
      contacts: items.map((c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        allowCampaign: c.allowCampaign,
        tagCount: c._count.tags,
        createdAt: c.createdAt.toISOString(),
      })),
    }));

  return NextResponse.json({ groups: dupGroups });
}
