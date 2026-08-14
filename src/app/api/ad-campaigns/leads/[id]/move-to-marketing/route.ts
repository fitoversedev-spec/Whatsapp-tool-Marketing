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

  const name = metaLead.fullName?.trim() || null;
  const city = metaLead.city;

  const existing = await prisma.contact.findUnique({ where: { phone } });
  if (existing) {
    // Merge the city into the existing fields (a JSON STRING) under the
    // "Attribute 1" key — the same key imported contacts use for city — and ONLY
    // when that key is still empty, so a value the user already curated is never
    // clobbered. Guard on city too. Every other key is preserved. NEVER touch
    // allowCampaign.
    let fields: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(existing.fields);
      if (parsed && typeof parsed === "object") fields = parsed as Record<string, unknown>;
    } catch {
      /* corrupt fields — start fresh */
    }
    const existingAttr1 = String(fields["Attribute 1"] ?? "").trim();
    if (city && !existingAttr1) fields["Attribute 1"] = city;
    await prisma.contact.update({
      where: { id: existing.id },
      // Only overwrite the name when we actually have one.
      data: { ...(name ? { name } : {}), fields: JSON.stringify(fields) },
    });
    return NextResponse.json({ ok: true, created: false });
  }

  await prisma.contact.create({
    data: {
      phone,
      name,
      allowCampaign: true,
      fields: JSON.stringify(city ? { "Attribute 1": city } : {}),
    },
  });
  return NextResponse.json({ ok: true, created: true });
}
