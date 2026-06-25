// Streaming-ish CSV export of selected contacts (or all if no ids given).
// Returns text/csv so the browser triggers a download with the filename
// hint we set in Content-Disposition.

import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const idsParam = req.nextUrl.searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter((s) => s.length > 0) : null;

  const contacts = await prisma.contact.findMany({
    where: ids ? { id: { in: ids } } : {},
    include: { tags: { include: { tag: true } } },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  // Determine all field keys actually present in the set, so the CSV has
  // a column for each. Sorted for stable ordering.
  const fieldKeys = new Set<string>();
  for (const c of contacts) {
    for (const k of Object.keys(parseFields(c.fields))) fieldKeys.add(k);
  }
  const orderedFieldKeys = Array.from(fieldKeys).sort();

  const header = [
    "phone",
    "name",
    "allow_campaign",
    "tags",
    ...orderedFieldKeys,
    "created_at",
  ];
  const rows = contacts.map((c) => {
    const fields = parseFields(c.fields);
    return [
      c.phone,
      c.name ?? "",
      c.allowCampaign ? "yes" : "no",
      c.tags.map((ct) => ct.tag.name).join("|"),
      ...orderedFieldKeys.map((k) => fields[k] ?? ""),
      c.createdAt.toISOString(),
    ];
  });

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell);
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(",")
    )
    .join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${Date.now()}.csv"`,
    },
  });
}
