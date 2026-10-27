// One website lead. GET returns the full detail (the form's custom answers,
// rep notes, labels and the duplicate badges); PATCH changes its stage and/or the
// assigned rep. Open to all signed-in users, same stance as the ad lead routes.
// Notes, labels, Move to CRM and Move to marketing have their own sub-routes.
// A removed lead is still readable here by admins and managers (it carries
// removedAt); for everyone else GET 404s, and every write 404s for all.
//
// [id] is WebsiteLead.id (not the website's own lead id).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isManagerOrAbove } from "@/lib/rbac";
import { getWebsiteLeadDetail } from "@/lib/website-leads/list";
import { updateWebsiteLead } from "@/lib/website-leads/writes";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const detail = await getWebsiteLeadDetail(params.id, { includeRemoved: isManagerOrAbove(user.role) });
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}

const patchSchema = z
  .object({
    stage: z.string().min(1).max(100).optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => b.stage !== undefined || b.assignedToUserId !== undefined, { message: "nothing to change" });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { stage, assignedToUserId } = parsed.data;

  const r = await updateWebsiteLead(params.id, { stage, assignedToUserId });
  if (r === "invalid_stage") return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  if (r === "invalid_assignee") return NextResponse.json({ error: "invalid_assignee" }, { status: 400 });
  if (r === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
