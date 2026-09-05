import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { publicTaxonomy } from "@/lib/scout/places/taxonomy";
import { getScanScreenData } from "@/lib/scout/scans/screenData";
import { ScanScreen } from "../ScanScreen";

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

/**
 * D2, showing a saved scan.
 *
 * Rendered on the server so the first paint carries whatever has landed —
 * including a scan that is still running, which `getScanResult` supports on
 * purpose. The client then polls progress and repaints.
 */
export default async function ScanDetailPage({ params }: { params: { id: string } }) {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");
  if (!identity.canRunScans) notFound();

  const { id } = params;
  const data = await getScanScreenData(identity, id);
  // A scan belonging to someone else is a 404, not a 403.
  if (!data) notFound();

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/dashboard" />
      </div>
      <ScanScreen
        taxonomy={publicTaxonomy()}
        initial={data}
        googleKeyMissing={!env.hasGoogleServerKey}
      />
    </>
  );
}
