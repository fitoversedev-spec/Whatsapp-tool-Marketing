import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  sport: z.string().max(100).nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { campaignId: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const campaign = await prisma.metaCampaign.findUnique({
    where: { metaId: params.campaignId },
    select: { id: true },
  });
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const updated = await prisma.metaCampaign.update({
    where: { id: campaign.id },
    data: { sport: parsed.data.sport },
  });

  if (parsed.data.sport) {
    await prisma.metaLead.updateMany({
      where: { campaignId: params.campaignId, sport: null },
      data: { sport: parsed.data.sport },
    });
  }

  return NextResponse.json({ ok: true, sport: updated.sport });
}
