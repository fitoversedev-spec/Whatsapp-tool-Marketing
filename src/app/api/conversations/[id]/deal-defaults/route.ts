// Lightweight lookup for QuoteWizard/CourtImageWizard's Step 1: if this
// conversation already has a Deal (a previous quote/design captured
// location + classification for this customer), return those values so
// the wizard can prefill instead of asking again. Returns { deal: null }
// for a fresh conversation with no Deal yet — the wizard just leaves its
// fields empty, same as before this endpoint existed.
//
// Deliberately separate from the much heavier GET .../profile route (notes,
// quotations, reminders, activity feed) — this needs exactly 4 fields and
// nothing else, sized for wizard-open latency, not a drawer render.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const convo = await prisma.conversation.findUnique({
    where: { id: params.id },
    select: { assignedToUserId: true },
  });
  if (!convo) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.role !== "admin" && convo.assignedToUserId !== null && convo.assignedToUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deal = await prisma.deal.findFirst({
    where: { conversationId: params.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: {
      siteCity: true,
      leadSourceId: true,
      account: { select: { customerProfileId: true, businessType: true } },
    },
  });

  return NextResponse.json({
    deal: deal
      ? {
          siteCity: deal.siteCity,
          leadSourceId: deal.leadSourceId,
          customerProfileId: deal.account.customerProfileId,
          businessType: deal.account.businessType,
        }
      : null,
  });
}
