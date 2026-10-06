// Mark a customer Won: creates their confirmed deal (final value, expected
// start, note) and moves them out of Leads. Also what "+ New Deal" calls.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { confirmDeal, ConfirmDealError } from "@/lib/crm/confirmDeal";

const schema = z.object({
  value: z.number().positive().max(999_999_999),
  expectedStartAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the final value" }, { status: 400 });

  try {
    const deal = await confirmDeal({
      contactId: params.id,
      value: parsed.data.value,
      expectedStartAt: parsed.data.expectedStartAt ? new Date(parsed.data.expectedStartAt) : null,
      note: parsed.data.note || null,
      actorUserId: user.id,
    });
    return NextResponse.json({ deal: { id: deal.id, code: deal.code } });
  } catch (err) {
    if (err instanceof ConfirmDealError) return NextResponse.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
