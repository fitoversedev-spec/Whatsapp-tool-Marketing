// GET /api/website-leads/analytics?section=…&range=…&from=…&to=… — the website
// analytics data for the Website Leads area (Google Analytics, Search Console and
// our own lead counts). Open to all signed-in users, like the leads table.
//
//   section  overview | live | sources | ai | pages | search | leadsBySource
//   range    7d | 30d (default) | this_month | last_month | custom (from / to as YYYY-MM-DD, IST)
//
//   200 { ok: true, connected: true, section, range, generatedAt, data }
//   200 { ok: true, connected: false, section, missing }   Google isn't set up (the server settings still missing)
//   400 { ok: false, error }                               unknown section / bad range
//   401 { ok: false, error }                               not signed in
//   502 { ok: false, error }                               Google (or the database) failed; error is safe to show
//
// "live" ignores the range. The data shapes are in src/lib/website-analytics/types.ts.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAnalytics, parseSection, resolveRange, type ResolvedRange } from "@/lib/website-analytics";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const section = parseSection(sp.get("section"));
  if (!section) return NextResponse.json({ ok: false, error: "Unknown section." }, { status: 400 });

  let range: ResolvedRange | null = null;
  if (section !== "live") {
    const resolved = resolveRange({ range: sp.get("range"), from: sp.get("from"), to: sp.get("to") });
    if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: 400 });
    range = resolved.range;
  }

  const result = await getAnalytics(section, range);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
