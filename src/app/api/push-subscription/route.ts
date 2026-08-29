import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  deviceLabel: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = subscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const { endpoint, keys, deviceLabel } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { userId_endpoint: { userId: me.id, endpoint } },
    create: {
      userId: me.id,
      endpoint,
      p256dhKey: keys.p256dh,
      authKey: keys.auth,
      deviceLabel: deviceLabel ?? null,
    },
    update: {
      p256dhKey: keys.p256dh,
      authKey: keys.auth,
      deviceLabel: deviceLabel ?? null,
    },
  });

  await prisma.user.update({
    where: { id: me.id },
    data: { pushEnabled: true },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;

  if (endpoint) {
    await prisma.pushSubscription.deleteMany({
      where: { userId: me.id, endpoint },
    });
  } else {
    await prisma.pushSubscription.deleteMany({ where: { userId: me.id } });
  }

  const remaining = await prisma.pushSubscription.count({
    where: { userId: me.id },
  });
  if (remaining === 0) {
    await prisma.user.update({
      where: { id: me.id },
      data: { pushEnabled: false },
    });
  }

  return NextResponse.json({ ok: true });
}
