// PUT /api/website-leads/[id]/labels { labelIds } — replace the labels applied to
// a website lead. Labels come from the shared catalogue ad leads use (list or
// create them with /api/ad-campaigns/labels). Open to all signed-in users.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { setWebsiteLeadLabels } from "@/lib/website-leads/writes";

const bodySchema = z.object({
  // The full set of applied label ids (order-insensitive); [] removes them all.
  labelIds: z.array(z.string().uuid()).max(50),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const r = await setWebsiteLeadLabels(params.id, parsed.data.labelIds);
  if (r.kind === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (r.kind === "invalid_label") return NextResponse.json({ error: "invalid_label" }, { status: 400 });
  return NextResponse.json({ ok: true, labels: r.labels });
}
