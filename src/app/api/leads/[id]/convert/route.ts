// Converts a general Lead (the Lead model — manual entry, referrals, and
// (going forward) chatbot leads mirrored by src/lib/chatbot/dispatch.ts)
// into a Deal. Before this route, nothing in the app could ever write
// Lead.convertedDealId — a lead could sit forever with no way to become a
// real sales opportunity, which silently zeroed out the "leads -> won"
// tracing src/lib/analytics/sources.ts is built around (see docs/DECISIONS.md).
//
// Distinct from PATCH /api/leads/[id]/route.ts, which despite the shared
// URL prefix operates on the unrelated BotLead model, not Lead.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildDealCode, nextDealSequenceForYear, defaultFunnelStageId } from "@/lib/crm/deals";
import { writeAudit } from "@/lib/audit";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const lead = await prisma.lead.findUnique({ where: { id: params.id } });
  if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (lead.convertedDealId) {
    return NextResponse.json({ error: "already_converted", dealId: lead.convertedDealId }, { status: 409 });
  }

  const name = lead.name.trim() || "Unknown customer";

  // Reuse an existing Account by exact case-insensitive name — same rule as
  // POST /api/deals' duplicate-prompt and the CRM backfill script. No
  // duplicate-confirm prompt here (unlike that route): this is a one-click
  // convert action, not a user-facing "create account" form.
  let account = await prisma.account.findFirst({
    where: { deletedAt: null, name: { equals: name, mode: "insensitive" } },
  });
  if (!account) {
    account = await prisma.account.create({
      data: { name, city: lead.city, ownerUserId: lead.ownerUserId ?? user.id },
    });
    await prisma.accountContact.create({
      data: { accountId: account.id, name, phone: lead.phone, isPrimary: true },
    });
  }

  const year = new Date().getFullYear();
  const stageId = await defaultFunnelStageId();

  let deal;
  let lastError: unknown = null;
  let nextSeq = await nextDealSequenceForYear(year);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      deal = await prisma.deal.create({
        data: {
          code: buildDealCode(year, nextSeq - 1),
          title: `${name}'s enquiry`,
          accountId: account.id,
          ownerUserId: lead.ownerUserId ?? user.id,
          currentStageId: stageId,
          leadSourceId: lead.leadSourceId,
          sourceDetail: lead.sourceDetail,
          siteCity: lead.city,
        },
      });
      break;
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      nextSeq += 1;
    }
  }
  if (!deal) {
    console.error("[leads/convert] deal code collision after retries", lastError);
    return NextResponse.json({ error: "Could not create the deal after retries. Try again in a moment." }, { status: 503 });
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: { convertedDealId: deal.id, convertedAt: new Date() },
  });

  await writeAudit({ actorId: user.id, entity: "Lead", entityId: lead.id, action: "UPDATE", diff: { convertedDealId: deal.id } });

  return NextResponse.json({ deal: { id: deal.id, code: deal.code } });
}
