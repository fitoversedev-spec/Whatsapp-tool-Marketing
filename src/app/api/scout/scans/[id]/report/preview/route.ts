/**
 * `GET /api/scout/scans/{id}/report/preview` — the report as HTML, for the signed-in
 * owner.
 *
 * Exactly the document the PDF is made from: same builder, same renderer, same
 * stylesheet. It exists for three reasons.
 *
 * 1. **It is the degraded path.** Where no Chromium is available — this
 *    environment today — a salesperson can still read and print the report
 *    rather than being told a file could not be produced and left with nothing.
 * 2. It makes a rendering bug inspectable without a PDF round trip.
 * 3. It is what the studio's "Open full preview" opens, so what the surveyor
 *    checks is the artefact, not an approximation of it.
 *
 * Authenticated and owner-scoped. The public, signed, expiring link is `/r/{id}`
 * and serves the PDF only — this route is never the thing a customer is sent.
 */

import { getScoutProfile } from "@/lib/scout/identity";
import { assembleReportInput } from "@/lib/scout/reports/data";
import { buildReportDocument } from "@/lib/scout/reports/document";
import { renderReportHtml } from "@/lib/scout/reports/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { id: string } }) {
  const author = await getScoutProfile();
  if (!author) return new Response("Not signed in.", { status: 401 });
  if (!author.canRunScans) return new Response("Not permitted.", { status: 403 });

  const { id } = context.params;
  const skipMap = new URL(request.url).searchParams.get("map") === "0";

  const input = await assembleReportInput(author, id, { skipMap });
  // 404 rather than 403 for somebody else's scan, per Phase 1.
  if (!input) return new Response("Scan not found.", { status: 404 });

  const html = await renderReportHtml(buildReportDocument(input));
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
