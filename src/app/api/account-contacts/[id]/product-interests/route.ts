// Product interest recorded on the contact itself — no deal needed (deals are
// confirmed projects only). Catalogue products and/or one free-text "Other".
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadContactForUser } from "@/lib/crm/contactAccess";
import { addProductInterests, UnknownProductError } from "@/lib/crm/contactWrites";

const schema = z.object({
  productIds: z.array(z.string().uuid()).max(30).default([]),
  otherLabel: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const res = await loadContactForUser(params.id, user, "edit");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.productIds.length && !parsed.data.otherLabel)) {
    return NextResponse.json({ error: "Pick at least one product" }, { status: 400 });
  }

  try {
    const { added } = await addProductInterests({
      contactId: params.id,
      productIds: parsed.data.productIds,
      otherLabel: parsed.data.otherLabel,
      createdByUserId: user.id,
    });
    return NextResponse.json({ added });
  } catch (err) {
    if (err instanceof UnknownProductError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
