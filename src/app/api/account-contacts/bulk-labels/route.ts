// POST /api/account-contacts/bulk-labels { ids, labelId, action } — add one label to
// (or take it off) many CRM contacts at once (the contacts list's tick boxes).
// Each contact is checked like a single edit: ones the user can't edit, and deleted
// or unknown ones, are skipped (counted) rather than failing the whole request.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { bulkChangeContactLabel, MAX_BULK_LABEL_CONTACTS } from "@/lib/crm/contactLabels";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_BULK_LABEL_CONTACTS),
  labelId: z.string().uuid(),
  action: z.enum(["add", "remove"]),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const r = await bulkChangeContactLabel(user, parsed.data);
  if (r.kind === "invalid_label") return NextResponse.json({ error: "invalid_label" }, { status: 400 });
  return NextResponse.json({ ok: true, changed: r.changed, skipped: r.skipped });
}
