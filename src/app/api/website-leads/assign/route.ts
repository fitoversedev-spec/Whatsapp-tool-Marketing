// Assign many website leads to one rep at once (the list's tick boxes -> "Assign
// to rep"). Admins and managers only, like the ad leads bulk assign.
// assignedToUserId null takes the rep off. The rep is not messaged: they find
// their leads with the list's rep filter.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isManagerOrAbove } from "@/lib/rbac";
import { MAX_LEADS_PER_REQUEST } from "@/lib/broadcast-groups";
import { assignWebsiteLeads } from "@/lib/website-leads/writes";

const schema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(MAX_LEADS_PER_REQUEST),
  assignedToUserId: z.string().uuid().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagerOrAbove(user.role)) {
    return NextResponse.json({ error: "Only admins and managers can assign leads in bulk" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { leadIds, assignedToUserId } = parsed.data;

  const r = await assignWebsiteLeads(leadIds, assignedToUserId);
  if (r.kind === "invalid_assignee") {
    return NextResponse.json({ error: "That rep can't be assigned leads" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, updated: r.updated, assignedToUserId, assignedToName: r.assignedToName });
}
