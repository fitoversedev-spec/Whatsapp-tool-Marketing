// PUT /api/account-contacts/[id]/labels { labelIds } — replace the labels applied to
// a CRM contact. Labels come from the shared catalogue ad leads and website leads
// use (list or create them with /api/ad-campaigns/labels). Needs the same access
// as editing the contact itself (a rep's own customers; admins/managers all).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { MAX_LABELS_PER_CONTACT, setContactLabels } from "@/lib/crm/contactLabels";

const bodySchema = z.object({
  // The full set of applied label ids (order-insensitive, duplicates ignored); [] removes them all.
  labelIds: z.array(z.string().uuid()).max(MAX_LABELS_PER_CONTACT),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const r = await setContactLabels(user, params.id, parsed.data.labelIds);
  if (r.kind === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.kind === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (r.kind === "invalid_label") return NextResponse.json({ error: "invalid_label" }, { status: 400 });
  return NextResponse.json({ ok: true, labels: r.labels });
}
