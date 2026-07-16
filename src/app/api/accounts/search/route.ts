// Lightweight account search — powers NewDealModal's "attach to an existing
// account" option (previously the only way to create a deal was always a
// brand-new inline Account, even for a customer who already had one — see
// docs/DECISIONS.md). Not owner-scoped, matching the existing duplicate-
// detection check in POST /api/deals, which also searches across every
// account regardless of who created it — reuse/dedup needs the whole
// universe of accounts, not just the current user's own.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ accounts: [] });

  const accounts = await prisma.account.findMany({
    where: { deletedAt: null, name: { contains: q, mode: "insensitive" } },
    select: { id: true, name: true, city: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  return NextResponse.json({ accounts });
}
