import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/scout/ui";
import { ScreenScaffold, StateBlock } from "@/components/scout/patterns";
import { getScoutIdentity } from "@/lib/scout/identity";
import { listDashboardScans } from "@/lib/scout/scans/queries";

import { ScanListClient } from "./ScanListClient";

export const metadata: Metadata = { title: "Saved Scans — Site Scout" };
export const dynamic = "force-dynamic";

/**
 * "My sites" — the saved-scan list in row form.
 *
 * The desktop counterpart of mobile screen 05. It is the same data as the
 * dashboard grid, arranged for scanning down rather than across: one row per
 * area with its headline stat and its score, so a salesperson looking for a
 * particular plot finds it by name rather than by picture.
 */
export default async function Page() {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");

  const scans = await listDashboardScans(identity);

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/dashboard" />
      </div>
      <ScreenScaffold
        eyebrow="Saved Scans"
        title="Saved Scans"
        lede="Every area you have scanned, newest first."
        actions={
          <Link href="/scout/scan">
            <Button>New site check</Button>
          </Link>
        }
      >
        {scans.length === 0 ? (
          <StateBlock
            eyebrow="Nothing saved yet"
            title="No scans yet"
            body="Run a scan to see the competing facilities and demand anchors around a plot. Nothing is billed until you press Run scan, and the cost is on screen before you do."
            action={
              <Link href="/scout/scan">
                <Button>New site check</Button>
              </Link>
            }
          />
        ) : (
          <ScanListClient scans={scans} />
        )}
      </ScreenScaffold>
    </>
  );
}
