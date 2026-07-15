// Creates the new general-purpose Lead model (referral/walk-in/manual
// entry) — this is the actual gap the spec is closing: BotLead only ever
// gets created by the chatbot (src/lib/chatbot/dispatch.ts), there was no
// manual-entry path at all before this.
//
// Note on the URL overlap: the pre-existing src/app/api/leads/[id]/route.ts
// PATCH endpoint operates on BotLead, not this Lead model — same base path,
// different underlying resource. Kept as-is rather than risk touching the
// working chatbot-lead UI; the /leads dashboard page merges both into one
// list per docs/DECISIONS.md, so the user-facing meaning stays coherent
// even though the two route files target different tables.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/rbac";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(1).max(30),
  email: z.string().email().max(200).optional(),
  city: z.string().max(100).optional(),
  rawEnquiryText: z.string().max(2000).optional(),
  leadSourceId: z.string().uuid().optional(),
  sourceDetail: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const lead = await prisma.lead.create({
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email ?? null,
      city: parsed.data.city ?? null,
      rawEnquiryText: parsed.data.rawEnquiryText ?? null,
      leadSourceId: parsed.data.leadSourceId ?? null,
      sourceDetail: parsed.data.sourceDetail ?? null,
      ownerUserId: user.id,
      status: "NEW",
    },
  });

  return NextResponse.json({ lead });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const ownerId = searchParams.get("ownerId");

  const where: Record<string, unknown> = {};
  if (ownerId) {
    where.ownerUserId = ownerId;
  } else if (!isAdmin(user.role)) {
    where.ownerUserId = user.id;
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      leadSource: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ leads });
}
