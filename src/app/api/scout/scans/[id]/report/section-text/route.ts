import { NextResponse } from "next/server";
import { getScoutProfile } from "@/lib/scout/identity";
import { assembleReportInput } from "@/lib/scout/reports/data";
import { buildReportDocument } from "@/lib/scout/reports/document";
import { sectionTextFromDocument } from "@/lib/scout/reports/section-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { id: string } }) {
  const author = await getScoutProfile();
  if (!author) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!author.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });

  const { id } = context.params;
  const input = await assembleReportInput(author, id, { skipMap: true });
  if (!input) return NextResponse.json({ error: "Scan not found." }, { status: 404 });

  const doc = buildReportDocument(input);
  const sectionText = sectionTextFromDocument(doc);

  return NextResponse.json({ sectionText }, { headers: { "Cache-Control": "no-store" } });
}
