import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { parseFields, contactPassesFilters, ContactFilterRule } from "@/lib/contacts";

// GET /api/contacts?search=&page=&field=&value=
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const search = (sp.get("search") ?? "").trim().toLowerCase();
  const field = (sp.get("field") ?? "").trim();
  const value = (sp.get("value") ?? "").trim();
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = 50;

  // Pull all contacts (pool is small for an internal tool) and filter in memory —
  // keeps JSON field filtering simple and consistent with the broadcast composer.
  const all = await prisma.contact.findMany({ orderBy: { createdAt: "desc" } });

  let filtered = all.map((c) => ({
    id: c.id,
    phone: c.phone,
    name: c.name,
    allowCampaign: c.allowCampaign,
    fields: parseFields(c.fields),
    createdAt: c.createdAt.toISOString(),
  }));

  if (search) {
    filtered = filtered.filter(
      (c) =>
        c.phone.toLowerCase().includes(search) ||
        (c.name ?? "").toLowerCase().includes(search)
    );
  }

  if (field && value) {
    const rule: ContactFilterRule = { field, condition: "equals", value };
    filtered = filtered.filter((c) => contactPassesFilters(c, [rule]));
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  return NextResponse.json({
    contacts: pageItems,
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
