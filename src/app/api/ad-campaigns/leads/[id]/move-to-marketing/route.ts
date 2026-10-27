// "Move to WhatsApp marketing" for a Meta Instant-Form lead — the sibling of
// Move to CRM. Upserts the lead's phone into the WhatsApp marketing Contact list
// (the same explicit, user-triggered, one-way sync as
// account-contacts/sync-to-marketing). Open to all approved reps. Idempotent:
// an existing marketing contact is updated (name + the city merged into the
// "Attribute 1" field — the same key the imported contacts store city in, and
// only when it's still empty so a curated value is never clobbered), never
// duplicated (NOT a 409), and its allowCampaign is NEVER touched, so a prior
// opt-out is preserved. New contacts default to allowCampaign:true, matching
// every other contact-creation path in this app.
//
// [id] is the MetaLead.id (not the raw Meta leadgen id).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { upsertMarketingContact } from "@/lib/meta-ads/leadWrites";
import { normalizePhone } from "@/lib/phone";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Open to all approved reps — reps work their own ad leads into the lists.

  const metaLead = await prisma.metaLead.findUnique({
    where: { id: params.id },
    select: { id: true, fullName: true, phone: true, normalizedPhone: true, city: true },
  });
  if (!metaLead) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Same E.164 key the marketing list dedupes on. Phase A already stamps
  // normalizedPhone at ingest; prefer it, but re-normalize the raw phone as a
  // fallback so this route stands on its own.
  const phone = (metaLead.phone ? normalizePhone(metaLead.phone) : null) ?? metaLead.normalizedPhone ?? null;
  if (!phone) return NextResponse.json({ error: "no_phone" }, { status: 422 });

  const { created } = await upsertMarketingContact({
    phone,
    name: metaLead.fullName?.trim() || null,
    city: metaLead.city,
  });
  return NextResponse.json({ ok: true, created });
}
