import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/scout/ui";
import { ScreenScaffold, StateBlock } from "@/components/scout/patterns";
import { canAccessAllScans, getScoutIdentity } from "@/lib/scout/identity";
import { getScan } from "@/lib/scout/places/scanRepository";
import { listComparableScans } from "@/lib/scout/scans/queries";
import { getSweep } from "@/lib/scout/sweep/repository";
import { formatRadius } from "@/lib/scout/display/format";
import { SweepScreen } from "./SweepScreen";

export const metadata: Metadata = { title: "Spaces sweep — Site Scout" };
export const dynamic = "force-dynamic";

/**
 * D3 — the spaces sweep, always attached to a scan.
 *
 * v16 kept sweeps in `localStorage` keyed on a typed area name, which lost them
 * to a cleared browser and hid them from everyone else. A sweep here belongs to
 * a scan, so `/scout/sweep` with no scan asks which one rather than opening a grid
 * with nowhere to save.
 */
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
        <SweepScreen
          scanId={scanId}
          areaLabel={scan.areaLabel}
          centre={scan.centre}
          radiusM={scan.radiusM}
          initialSweep={sweep}
        />
      );
    }
  }

  const scans = await listComparableScans(identity);

  return (
    <ScreenScaffold
      eyebrow="Spaces sweep"
      title="Pick the area to sweep"
      lede="A sweep is saved against a scan, so it stays with the area everyone else can see."
    >
      {scans.length === 0 ? (
        <StateBlock
          eyebrow="Nothing to sweep yet"
          title="Run a scan first"
          body="A sweep records the vacant plots and terraces you spot inside a scanned area. Run a scan so there is somewhere to save it."
          action={
            <Link href="/scout/scan">
              <Button>New scan</Button>
            </Link>
          }
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {scans.map((scan) => (
            <Link key={scan.id} href={`/scout/sweep?scanId=${scan.id}`}>
              <Button variant="secondary" block>
                {scan.areaLabel} · {formatRadius(scan.radiusM)}
              </Button>
            </Link>
          ))}
        </div>
      )}
    </ScreenScaffold>
  );
}
