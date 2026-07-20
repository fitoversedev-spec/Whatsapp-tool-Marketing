// Explicit, one-way sync: CRM AccountContact(s) -> the WhatsApp marketing
// Contact list. The two lists are deliberately separate and never
// auto-synced (see docs/DECISIONS.md) — this is a user-triggered action,
// never automatic, and only ever flows CRM -> marketing, not the reverse.
// New marketing contacts default to allowCampaign:true (matching every
// other contact-creation path in this app); if the phone number already
// exists in the marketing list, only its name is updated — never
// allowCampaign, so an existing opt-out is never silently overridden.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";
import { normalizePhone } from "@/lib/phone";

const schema = z.object({
  contactIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const contacts = await prisma.accountContact.findMany({
    where: { id: { in: parsed.data.contactIds } },
    include: { account: { select: { ownerUserId: true } } },
  });

  let synced = 0, skippedNoPhone = 0, skippedForbidden = 0;
  for (const contact of contacts) {
    if (!isAdmin(user.role) && contact.account.ownerUserId && contact.account.ownerUserId !== user.id) {
      skippedForbidden++;
      continue;
    }
    const phone = contact.phone ? normalizePhone(contact.phone) : null;
    if (!phone) {
      skippedNoPhone++;
      continue;
    }
    const existing = await prisma.contact.findUnique({ where: { phone } });
    if (existing) {
      await prisma.contact.update({ where: { id: existing.id }, data: { name: contact.name } });
    } else {
      await prisma.contact.create({ data: { phone, name: contact.name, allowCampaign: true } });
    }
    synced++;
  }

  return NextResponse.json({ synced, skippedNoPhone, skippedForbidden });
}
