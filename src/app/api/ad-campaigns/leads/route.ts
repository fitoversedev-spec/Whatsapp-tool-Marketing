// GET /api/ad-campaigns/leads — the Ad Campaigns lead tables' data source: one
// page of 50 light rows (no raw form answers) for a date window / campaign /
// filter set. Open to all signed-in users, same stance as the sibling lead
// routes (ad leads aren't rep-scoped).
//
//   default      → { rows, total, page, pageCount, maxSelectable }
//   + facets=1   → also { breakdown } (city / sport / area / assigned counts for the filtered set)
//   + options=1  → also { options } (dropdown choices for the whole window / campaign)
//   idsOnly=1    → { ids, total } — every matching lead id, capped (Select all N matching)
//   export=1     → { rows, total, capped } — rows for the CSV / XLSX export, capped
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  buildLeadWhere,
  getLeadExportRows,
  getLeadFacets,
  getLeadIds,
  getLeadPage,
  LEAD_EXPORT_CAP,
  LEAD_IDS_CAP,
  parseLeadRange,
  type LeadFilters,
} from "@/lib/meta-ads/lead-list";

// The start-time filter and export read form answers server-side.
export const maxDuration = 30;

function filtersFrom(sp: URLSearchParams): LeadFilters {
  const { from, to } = parseLeadRange(sp.get("from"), sp.get("to"));
  const text = (k: string) => (sp.get(k) ?? "").trim().slice(0, 200) || undefined;
  // Stage / label / start time are exact matches, so they are passed through as sent.
  const exact = (k: string) => (sp.get(k) ?? "").slice(0, 200) || undefined;
  return {
    from,
    to,
    campaignId: text("campaign"),
    city: text("city"),
    sport: text("sport"),
    area: text("area"),
    start: exact("start"),
    stage: exact("stage"),
    assigned: text("assigned"),
    label: exact("label"),
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const sp = req.nextUrl.searchParams;
    const filters = filtersFrom(sp);

    if (sp.get("idsOnly") === "1") {
      const { ids, total } = await getLeadIds(filters);
      return NextResponse.json({ ids, total, capped: total > LEAD_IDS_CAP });
    }

    if (sp.get("export") === "1") {
      const { rows, total } = await getLeadExportRows(filters);
      return NextResponse.json({ rows, total, capped: total > LEAD_EXPORT_CAP });
    }

    const page = Math.floor(Number(sp.get("page"))) || 1;
    const wantFacets = sp.get("facets") === "1";
    const wantOptions = sp.get("options") === "1";
    // Built once: the start-time / area filters read form answers to build it.
    const where = await buildLeadWhere(filters);
    const [pageData, facets] = await Promise.all([
      getLeadPage(filters, page, where),
      wantFacets || wantOptions
        ? getLeadFacets(filters, { breakdown: wantFacets, options: wantOptions }, where)
        : Promise.resolve({}),
    ]);
    return NextResponse.json({ ...pageData, ...facets });
  } catch (err) {
    console.error("[ad-campaigns/leads] failed", err);
    return NextResponse.json({ error: "Couldn't load these leads." }, { status: 500 });
  }
}
