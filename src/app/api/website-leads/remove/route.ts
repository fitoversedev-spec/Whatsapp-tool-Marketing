// Remove website leads from Fito Website, bring removed ones back, or delete removed
// ones for good (the list's tick boxes -> "Remove" / "Restore" / "Delete permanently",
// and the detail page). Admins and managers can remove and restore, like the bulk
// assign; deleting permanently is admins only. Remove is a soft delete: the lead keeps
// its row and comes back with Show removed -> Restore. Delete erases a lead that is
// already removed, with its notes and labels. CRM contacts, WhatsApp marketing contacts
// and group memberships made from a lead are not touched by any of the three.
// Body: { ids, action }, ids are WebsiteLead.id. Response: { ok, changed } — only
// leads not already in that state count (delete: only removed leads).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, isManagerOrAbove } from "@/lib/rbac";
import { deleteRemovedWebsiteLeads, setWebsiteLeadsRemoved } from "@/lib/website-leads/writes";

// The list sends bigger selections in batches of this size.
const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["remove", "restore", "delete"]),
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

  if (action === "delete") {
    if (!isAdmin(user.role)) {
      return NextResponse.json({ error: "Only admins can delete leads permanently" }, { status: 403 });
    }
    const deleted = await deleteRemovedWebsiteLeads(ids);
    console.info(`[website-leads] permanently deleted ${deleted} lead(s), by user ${user.id}`);
    return NextResponse.json({ ok: true, changed: deleted });
  }

  const changed = await setWebsiteLeadsRemoved(ids, action === "remove");
  return NextResponse.json({ ok: true, changed });
}
