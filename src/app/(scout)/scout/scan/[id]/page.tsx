import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { getScoutIdentity, getScoutProfile } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { prisma } from "@/lib/prisma";
import { publicTaxonomy, type CustomCategoryRow } from "@/lib/scout/places/taxonomy";
import { defaultBlockState } from "@/lib/scout/reports/blocks";
import { latestGeneratedReport, reportLink } from "@/lib/scout/reports/generate";
import { getReportDraft } from "@/lib/scout/reports/repository";
import { getScanScreenData } from "@/lib/scout/scans/screenData";
import { ScanPageClient } from "../ScanPageClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const identity = await getScoutIdentity();
  if (!identity?.canRunScans) return { title: "Scan — Site Scout" };
  const { id } = params;
  const data = await getScanScreenData(identity, id);
  return { title: data ? `${data.areaLabel} — Site Scout` : "Scan — Site Scout" };
}

export default async function ScanDetailPage({ params }: { params: { id: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");
  if (!identity.canRunScans) notFound();

  const { id } = params;
  const [data, author, customs] = await Promise.all([
    getScanScreenData(identity, id),
    getScoutProfile(),
    prisma.customCategory.findMany({
      select: { id: true, label: true, side: true, searchQuery: true, googleType: true },
      orderBy: { createdAt: "asc" },
    }) as Promise<CustomCategoryRow[]>,
  ]);
  if (!data) notFound();

  const [draft, generated] = await Promise.all([
    getReportDraft(id),
    latestGeneratedReport(id),
  ]);

  const initialReport =
    generated && generated.expiresAt
      ? { ...generated, link: reportLink(generated.id, new Date(generated.expiresAt)) }
      : generated
        ? { ...generated, link: null }
        : null;

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/sites" />
      </div>
      <ScanPageClient
        taxonomy={publicTaxonomy(customs)}
        initial={data}
        googleKeyMissing={!env.hasGoogleServerKey}
        preparedBy={author?.displayName ?? ""}
        initialBlocks={draft?.includedBlocks ?? defaultBlockState()}
        initialNotes={draft?.fieldNotes ?? data.fieldNotes ?? ""}
        initialSuggestions={draft?.suggestionsText ?? ""}
        initialPolished={draft?.polishedSuggestions ?? ""}
        initialReport={initialReport}
      />
    </>
  );
}
