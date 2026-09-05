import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { getScoutProfile } from "@/lib/scout/identity";
import { defaultBlockState } from "@/lib/scout/reports/blocks";
import { latestGeneratedReport, reportLink } from "@/lib/scout/reports/generate";
import { getReportDraft } from "@/lib/scout/reports/repository";
import { getScanScreenData } from "@/lib/scout/scans/screenData";
import { getSweep } from "@/lib/scout/sweep/repository";
import { ReportStudio } from "./ReportStudio";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const author = await getScoutProfile();
  if (!author?.canRunScans) return { title: "Report studio — Site Scout" };
  const { id } = params;
  const scan = await getScanScreenData(author, id);
  return { title: scan ? `${scan.areaLabel} report — Site Scout` : "Report studio — Site Scout" };
}

/**
 * D5 — the report studio.
 *
 * `[id]` is the **scan** id, not a report id. A report is a document *about* a
 * scan and a scan may produce several over time; the studio always composes the
 * current draft for that scan. Every route that links here — the D2 "Create
 * report" CTA, the dashboard's recent-reports rail, the comparison footer —
 * holds a scan id, so this is the id that is actually available at every call
 * site.
 */
export default async function ReportPage({ params }: { params: { id: string } }) {
  const author = await getScoutProfile();
  if (!author) redirect("/login");
  if (!author.canRunScans) notFound();

  const { id } = params;
  const scan = await getScanScreenData(author, id);
  if (!scan) notFound();

  const [draft, sweep, generated] = await Promise.all([
    getReportDraft(id),
    getSweep(id),
    latestGeneratedReport(id),
  ]);

  // Reopening the studio must show the report that already exists, with its
  // live link — otherwise a salesperson who closed the tab regenerates a
  // document that was already sent, and the customer's link goes stale.
  const initialReport =
    generated && generated.expiresAt
      ? { ...generated, link: reportLink(generated.id, new Date(generated.expiresAt)) }
      : generated
        ? { ...generated, link: null }
        : null;

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref={`/scout/scan/${id}`} />
      </div>
      <ReportStudio
        scan={scan}
        sweep={sweep}
        initialBlocks={draft?.includedBlocks ?? defaultBlockState()}
        initialNotes={draft?.fieldNotes ?? scan.fieldNotes ?? ""}
        preparedBy={author.displayName}
        initialReport={initialReport}
      />
    </>
  );
}
