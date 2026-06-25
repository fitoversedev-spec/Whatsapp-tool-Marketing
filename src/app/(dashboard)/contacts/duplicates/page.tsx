import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DuplicatesClient from "./DuplicatesClient";

function canonicalize(phone: string): string {
  return phone.replace(/[^0-9]/g, "").replace(/^0+/, "");
}

export default async function DuplicatesPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/contacts");

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

  const groups = new Map<string, typeof all>();
  for (const c of all) {
    const key = canonicalize(c.phone);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

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

  return <DuplicatesClient groups={dupGroups} />;
}
