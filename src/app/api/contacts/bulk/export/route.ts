// Streaming-ish CSV export of selected contacts (or all if no ids given).
// Returns text/csv so the browser triggers a download with the filename
// hint we set in Content-Disposition.
//   GET  ?ids=a,b,c — a handful of ticked contacts
//   POST form field ids=a,b,c — any number ("Select all N matching" can tick
//        hundreds, which would be too long for a URL)

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFields } from "@/lib/contacts";
import { chunkIds } from "@/lib/broadcast-groups";

function parseIds(raw: string | null): string[] | null {
  return raw ? raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : null;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  return csvResponse(parseIds(req.nextUrl.searchParams.get("ids")));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const form = await req.formData().catch(() => null);
  const ids = parseIds(form ? String(form.get("ids") ?? "") : null);
  // A POST always names its contacts — never fall back to exporting everyone.
  if (!ids?.length) return new Response("no contacts selected", { status: 400 });
  return csvResponse(ids);
}

async function csvResponse(ids: string[] | null): Promise<Response> {
  const load = (where: Prisma.ContactWhereInput, take?: number) =>
    prisma.contact.findMany({
      where,
      include: { tags: { include: { tag: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  let contacts: Awaited<ReturnType<typeof load>> = [];
  if (ids) {
    // Named contacts: 1,000 ids per query (no row cap — they asked for these),
    // then back into newest-first order.
    for (const part of chunkIds(ids)) contacts.push(...(await load({ id: { in: part } })));
    contacts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else {
    contacts = await load({}, 10000);
  }

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
