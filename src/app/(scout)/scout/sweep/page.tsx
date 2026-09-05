import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { getSweep } from "@/lib/scout/sweep/repository";
import { FindSpacesScreen } from "./FindSpacesScreen";
import { SweepScreen } from "./SweepScreen";

export const metadata: Metadata = { title: "Find Spaces — Site Scout" };
export const dynamic = "force-dynamic";

export default async function SweepPage({
  searchParams,
}: {
  searchParams: { scanId?: string };
}) {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");
  if (!identity.canRunScans) notFound();

  const { scanId } = searchParams;

  if (scanId) {
    const scan = await getScan(scanId);
    if (scan && (scan.ownerId === identity.userId || canAccessAllScans(identity))) {
      const sweep = await getSweep(scanId);
      return (
        <>
          <div className="px-4 sm:px-6 lg:px-8 pt-3">
            <BackButton backHref="/scout/sweep" />
          </div>
          <SweepScreen
            scanId={scanId}
            areaLabel={scan.areaLabel}
            centre={scan.centre}
            radiusM={scan.radiusM}
            initialSweep={sweep}
          />
        </>
      );
    }
  }

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/dashboard" />
      </div>
      <FindSpacesScreen />
    </>
  );
}
