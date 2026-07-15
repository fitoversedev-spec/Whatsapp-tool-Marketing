import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// All fields optional so the same endpoint handles "just change my name",
// "just change my preferred unit", or "just set my WhatsApp number" — at
// least one must be present. phone is nullable-on-purpose (empty string
// clears it, disabling bot commands for this user rather than leaving a
// stale number matched).
const schema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    preferredUnit: z.enum(["ft", "m"]).optional(),
    phone: z
      .string()
      .max(20)
      .regex(/^\+?\d{7,15}$/, "Enter digits only, e.g. 919876543210")
      .or(z.literal(""))
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.preferredUnit !== undefined || v.phone !== undefined, {
    message: "at least one field required",
  });

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  if (parsed.data.phone) {
    const taken = await prisma.user.findFirst({
      where: { phone: parsed.data.phone, id: { not: me.id } },
      select: { id: true },
    });
    if (taken) return NextResponse.json({ error: "That number is already linked to another account." }, { status: 409 });
  }

  await prisma.user.update({
    where: { id: me.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.preferredUnit !== undefined && {
        preferredUnit: parsed.data.preferredUnit,
      }),
      ...(parsed.data.phone !== undefined && { phone: parsed.data.phone || null }),
    },
  });

  // Refresh session name so sidebar updates without re-login. Preferred
  // unit isn't in the session — the client refetches from /api/auth/me
  // and useUserUnit swaps on next render.
  if (parsed.data.name !== undefined) {
    const session = await getSession();
    session.name = parsed.data.name;
    await session.save();
  }

  return NextResponse.json({ ok: true });
}
