// Invoice analytics — admin-only. Same gate + param convention as
// /api/crm/analytics/patterns and /usage.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { getInvoiceAnalytics } from "@/lib/analytics/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDateParam(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), new Date("2000-01-01T00:00:00Z"));
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();

  const data = await getInvoiceAnalytics({ from, to });
  return NextResponse.json(data);
}
