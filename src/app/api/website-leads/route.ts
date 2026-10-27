// GET /api/website-leads — the website leads table's data source: one page of 50
// light rows for a date window / filter set. Open to all signed-in users, same
// stance as the ad leads list (/api/ad-campaigns/leads).
//
//   default      → { rows, total, page, pageCount, maxSelectable }
//   + facets=1   → also { breakdown } (city / sport / assigned / cameFrom counts for the filtered set)
//   + options=1  → also { options } (dropdown choices for the whole date window)
//   idsOnly=1    → { ids, total, capped } — every matching lead id, capped (Select all N matching)
//   export=1     → { rows, total, capped } — rows for the CSV / XLSX export, capped
//
// Filters (all optional): from, to (YYYY-MM-DD, received date), city, sport,
// areaMin, areaMax (sq ft), stage (slug), assigned ("unassigned", a user id or
// part of a name), label (name), cameFrom (where it came from: a label such as
// "ChatGPT", or "unknown" for leads with no attribution), q (name / phone / email), page.
// removed=1 lists ONLY the removed leads (and every response above is then about that
// set); admins and managers only — for anyone else it is ignored.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isManagerOrAbove } from "@/lib/rbac";
import {
  WEBSITE_LEAD_EXPORT_CAP,
  WEBSITE_LEAD_IDS_CAP,
  getWebsiteLeadExportRows,
  getWebsiteLeadFacets,
  getWebsiteLeadIds,
  getWebsiteLeadPage,
  parseLeadRange,
  type WebsiteLeadFilters,
} from "@/lib/website-leads/list";

export const maxDuration = 30;

function filtersFrom(sp: URLSearchParams, canSeeRemoved: boolean): WebsiteLeadFilters {
  const { from, to } = parseLeadRange(sp.get("from"), sp.get("to"));
  const text = (k: string) => (sp.get(k) ?? "").trim().slice(0, 200) || undefined;
  // Stage / label are exact matches, so they are passed through as sent.
  const exact = (k: string) => (sp.get(k) ?? "").slice(0, 200) || undefined;
  const num = (k: string) => {
    const raw = (sp.get(k) ?? "").trim();
    const n = raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? Math.round(n) : undefined;
  };
  return {
    from,
    to,
    city: text("city"),
    sport: text("sport"),
    areaMin: num("areaMin"),
    areaMax: num("areaMax"),
    stage: exact("stage"),
    assigned: text("assigned"),
    label: exact("label"),
    cameFrom: text("cameFrom"),
    q: text("q"),
    removed: (canSeeRemoved && sp.get("removed") === "1") || undefined,
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const sp = req.nextUrl.searchParams;
    const filters = filtersFrom(sp, isManagerOrAbove(user.role));

    if (sp.get("idsOnly") === "1") {
      const { ids, total } = await getWebsiteLeadIds(filters);
      return NextResponse.json({ ids, total, capped: total > WEBSITE_LEAD_IDS_CAP });
    }

    if (sp.get("export") === "1") {
      const { rows, total } = await getWebsiteLeadExportRows(filters);
      return NextResponse.json({ rows, total, capped: total > WEBSITE_LEAD_EXPORT_CAP });
    }

    const page = Math.floor(Number(sp.get("page"))) || 1;
    const wantFacets = sp.get("facets") === "1";
    const wantOptions = sp.get("options") === "1";
    const [pageData, facets] = await Promise.all([
      getWebsiteLeadPage(filters, page),
      wantFacets || wantOptions
        ? getWebsiteLeadFacets(filters, { breakdown: wantFacets, options: wantOptions })
        : Promise.resolve({}),
    ]);
    return NextResponse.json({ ...pageData, ...facets });
  } catch (err) {
    console.error("[website-leads] list failed", err);
    return NextResponse.json({ error: "Couldn't load these leads." }, { status: 500 });
  }
}
