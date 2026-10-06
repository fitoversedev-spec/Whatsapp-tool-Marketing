// List deals (GET). Creating deals here is retired — see POST below.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSeeAllCustomers } from "@/lib/rbac";

// Creating deals here is retired: a deal is a confirmed project, created only
// with "Won" on a customer (POST /api/account-contacts/[id]/won).
export async function POST() {
  return NextResponse.json({ error: "This action is no longer available — deals are created by marking a customer Won" }, { status: 410 });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerId = searchParams.get("ownerId");
  const stageId = searchParams.get("stageId");
  const channel = searchParams.get("channel"); // "whatsapp" | "crm"

  // Sales sees only their own deals by default; admin sees everything
  // (matches the existing inbox/pipeline ownership-scoping pattern —
  // manager/management office-scoping lands when those roles get adopted
  // here per docs/DECISIONS.md).
  const where: Record<string, unknown> = {
    deletedAt: null,
    ...(stageId ? { currentStageId: stageId } : {}),
    ...(channel === "whatsapp" || channel === "crm" ? { dealChannel: channel } : {}),
  };
  // A rep may only filter to their own deals — asking for someone else's
  // ownerId used to return them.
  if (ownerId && (canSeeAllCustomers(user.role) || ownerId === user.id)) {
    where.ownerUserId = ownerId;
  } else if (!canSeeAllCustomers(user.role)) {
    where.ownerUserId = user.id;
  }

  const deals = await prisma.deal.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      account: { select: { id: true, name: true, city: true } },
      currentStage: { select: { id: true, name: true, slug: true, stageType: true, colorHex: true } },
      owner: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ deals });
}
