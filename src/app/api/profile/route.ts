import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// Both fields are optional so the same endpoint handles "just change
// my name" and "just change my preferred unit". If neither is provided
// the payload is invalid.
const schema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    preferredUnit: z.enum(["ft", "m"]).optional(),
  })
  .refine((v) => v.name !== undefined || v.preferredUnit !== undefined, {
    message: "at least one field required",
  });

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  await prisma.user.update({
    where: { id: me.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.preferredUnit !== undefined && {
        preferredUnit: parsed.data.preferredUnit,
      }),
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
