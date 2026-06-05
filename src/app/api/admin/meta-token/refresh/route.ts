// Force-refresh the stored token. Useful for a daily cron or manual button.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exchangeForLongToken } from "@/lib/token-manager";

export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tokenRow = await prisma.setting.findUnique({ where: { key: "meta_access_token" } });
  if (!tokenRow?.value) {
    return NextResponse.json(
      { error: "No token stored yet. Seed one via POST /api/admin/meta-token first." },
      { status: 400 }
    );
  }

  try {
    const result = await exchangeForLongToken(tokenRow.value);
    return NextResponse.json({
      ok: true,
      expiresAt: result.expiresAt,
      expiresAtIso: new Date(result.expiresAt * 1000).toISOString(),
      daysUntilExpiry: Math.floor((result.expiresAt - Date.now() / 1000) / (24 * 60 * 60)),
    });
  } catch (err: any) {
    const message =
      err?.response?.data?.error?.message ?? err?.message ?? "Token refresh failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
