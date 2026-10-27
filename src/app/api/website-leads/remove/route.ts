// Remove website leads from Fito Website, or bring removed ones back (the list's
// tick boxes -> "Remove" / "Restore", and the detail page). Admins and managers
// only, like the bulk assign. A soft delete: the lead keeps its row and comes back
// with Show removed -> Restore. CRM contacts, WhatsApp marketing contacts and group
// memberships made from a lead are not touched.
// Body: { ids, action }, ids are WebsiteLead.id. Response: { ok, changed } — only
// leads not already in that state count.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isManagerOrAbove } from "@/lib/rbac";
import { setWebsiteLeadsRemoved } from "@/lib/website-leads/writes";

// The list sends bigger selections in batches of this size.
const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["remove", "restore"]),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagerOrAbove(user.role)) {
    return NextResponse.json({ error: "Only admins and managers can remove leads" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const { ids, action } = parsed.data;

  const changed = await setWebsiteLeadsRemoved(ids, action === "remove");
  return NextResponse.json({ ok: true, changed });
}
