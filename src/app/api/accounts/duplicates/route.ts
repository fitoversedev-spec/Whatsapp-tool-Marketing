// Admin-only duplicate-group finder for Account — same shape as
// /api/contacts/duplicates, grouping on name(+city) instead of phone.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const all = await prisma.account.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      city: true,
      gstin: true,
      createdAt: true,
      _count: { select: { deals: true, contacts: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, typeof all>();
  for (const a of all) {
    const key = `${a.name.trim().toLowerCase()}|${(a.city ?? "").trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  const dupGroups = Array.from(groups.values())
    .filter((items) => items.length >= 2)
    .map((items) => ({
      accounts: items.map((a) => ({
        id: a.id,
        name: a.name,
        city: a.city,
        gstin: a.gstin,
        dealCount: a._count.deals,
        contactCount: a._count.contacts,
        createdAt: a.createdAt.toISOString(),
      })),
    }));

  return NextResponse.json({ groups: dupGroups });
}
