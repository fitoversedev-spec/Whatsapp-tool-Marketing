// Insights & Digest group's DATA path (Phase 5 analytics v2 — the A11 insight
// FEED, distinct from Phase 4's "Industry Insights" group served by
// /api/crm/analytics/insights). It composes generateInsights (insights.ts) +
// buildDigest (digest.ts) into the { insights, digest } the "Insight Feed" and
// "Digest" tabs render.
//
// DELIBERATE DIFFERENCE FROM EVERY OTHER ANALYTICS GROUP ROUTE: this one is NOT
// hard admin-gated. /patterns, /quadrants and /insights each 403 a non-admin,
// because their whole nav group is admin-only. This route can't, because the
// NON-admin Performance→Overview personal insight card fetches exactly this
// endpoint (per the plan's nav table: "A personal-scope insight card embeds in
// their Performance→Overview"). So the gate here is only getCurrentUser (401 if
// none); scope is then decided by resolveAnalyticsScope, and generateInsights /
// buildDigest re-run that same scope internally and FORCE a non-admin's
// ownerIds to [user.id] — a non-admin physically cannot receive another rep's
// insights through this route. The admin-only surfaces (the full "Insights &
// Digest" nav GROUP and the Decision Log) are gated in the client / on their
// own admin route, not here.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin, type Role } from "@/lib/rbac";
import { resolveAnalyticsScope } from "@/lib/analytics/scope";
import { generateInsights } from "@/lib/analytics/insights";
import { buildDigest, type DigestInsight } from "@/lib/analytics/digest";
import { isEmailConfigured } from "@/lib/email/send";

export const runtime = "nodejs";
export const maxDuration = 30;

function parseDateParam(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = resolveAnalyticsScope({ id: user.id, role: user.role as Role });

  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = parseDateParam(req.nextUrl.searchParams.get("from"), defaultFrom);
  const toParam = req.nextUrl.searchParams.get("to");
  const to = toParam ? new Date(toParam + "T23:59:59") : new Date();

  // Same owner-narrowing rule as /overview: a query param can only ever narrow
  // an admin's company-wide view — a non-admin's own scope always wins. (This
  // is belt-and-braces: generateInsights/buildDigest force the same scope
  // internally regardless of what's passed here.)
  const ownerParam = req.nextUrl.searchParams.get("owner");
  const requestedOwnerIds = ownerParam && ownerParam !== "all" ? [ownerParam] : undefined;
  const ownerIds = scope.companyWide ? requestedOwnerIds : scope.ownerIds;

  const filter = { from, to, ownerIds, dealChannel: "crm" as const };
  const scopedUser = { id: user.id, role: user.role as Role };

  const insights = await generateInsights(scopedUser, filter);

  // The digest surface renders from the same insights, down-projected to the
  // fields DigestInsight carries (digest.ts intentionally doesn't import
  // generateInsights — the composition happens at the call site, here).
  const digestInsights: DigestInsight[] = insights.map((i) => ({
    title: i.title,
    detail: i.detail,
    recommendedAction: i.recommendedAction,
    severity: i.severity,
    n: i.n,
  }));
  const digest = await buildDigest(scopedUser, filter, digestInsights);

  // emailConfigured is a plain boolean (isEmailConfigured() returns
  // !!RESEND_API_KEY) — the key itself is never serialized. The admin Digest
  // tab uses it only to show/hide the "email delivery not yet enabled" note.
  return NextResponse.json({
    isAdmin: isAdmin(user.role),
    emailConfigured: isEmailConfigured(),
    insights,
    digest,
  });
}
