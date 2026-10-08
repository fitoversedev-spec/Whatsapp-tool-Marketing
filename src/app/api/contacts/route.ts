import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { listContacts, listContactIds, CONTACTS_PAGE_SIZE } from "@/lib/contacts-query";

// GET /api/contacts?search=&page=&field=&value=&tag=[&idsOnly=1]
// Filtering and paging happen in the database (see contacts-query.ts), which
// also trims/lower-cases the search and caps it at 200 characters.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const filter = {
    search: sp.get("search"),
    field: sp.get("field"),
    value: sp.get("value"),
    tag: sp.get("tag"),
  };

  // ?idsOnly=1 — every matching id, unpaged: "Select all N matching" on the
  // Contacts page and in a group's "Add people" picker.
  if (sp.get("idsOnly") === "1") {
    const ids = await listContactIds(filter);
    return NextResponse.json({ ids, total: ids.length });
  }

  // parseInt gives NaN for junk like ?page=abc; fall back to page 1.
  const rawPage = Number.parseInt(sp.get("page") ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, 100_000) : 1;
  const pageSize = CONTACTS_PAGE_SIZE;

  const { contacts, total } = await listContacts(filter, page);

  return NextResponse.json({
    contacts,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

const createSchema = z.object({
  phone: z.string().min(5),
  name: z.string().max(200).optional().nullable(),
  allowCampaign: z.boolean().optional().default(true),
  fields: z.record(z.string(), z.string()).optional(),
});

// POST /api/contacts — add a single contact manually
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const existing = await prisma.contact.findUnique({ where: { phone } });
  if (existing) {
    return NextResponse.json({ error: "A contact with this phone already exists" }, { status: 409 });
  }

  const contact = await prisma.contact.create({
    data: {
      phone,
      name: parsed.data.name ?? null,
      allowCampaign: parsed.data.allowCampaign ?? true,
      fields: JSON.stringify(parsed.data.fields ?? {}),
    },
  });

  return NextResponse.json({ contact: { id: contact.id, phone: contact.phone } });
}
