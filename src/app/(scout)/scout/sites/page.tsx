import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/scout/ui";
import { ScreenScaffold, StateBlock } from "@/components/scout/patterns";
import { ScoreBadge } from "@/components/scout/score";
import { getScoutIdentity } from "@/lib/scout/identity";
import { listDashboardScans } from "@/lib/scout/scans/queries";
import { atLeast, formatDayMonth, formatRadius } from "@/lib/scout/display/format";
import styles from "./Sites.module.css";

export const metadata: Metadata = { title: "My sites — Site Scout" };
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
    <ScreenScaffold
      eyebrow="My sites"
      title="My sites"
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
          title="No sites yet"
          body="Run a scan to see the competing facilities and demand anchors around a plot. Nothing is billed until you press Run scan, and the cost is on screen before you do."
          action={
            <Link href="/scout/scan">
              <Button>New site check</Button>
            </Link>
          }
        />
      ) : (
        <div className={styles.list}>
          {scans.map((scan) => (
            <Link key={scan.id} href={`/scout/scan/${scan.id}`} className={styles.row}>
              <span className={styles.main}>
                <span className={styles.name}>{scan.areaLabel}</span>
                <span className={styles.meta}>
                  {formatRadius(scan.radiusM)} · {formatDayMonth(scan.createdAt)} ·{" "}
                  {scan.ownerName}
                  {scan.customerName ? ` · ${scan.customerName}` : ""}
                </span>
              </span>
              <span className={styles.stat}>
                <span className={styles.statValue}>
                  {scan.facilityCount === null
                    ? "—"
                    : atLeast(scan.facilityCount, scan.saturated)}
                </span>
                <span className={styles.statLabel}>Facilities</span>
              </span>
              <ScoreBadge
                total={scan.scoreTotal}
                verdict={scan.scoreVerdict}
                basis={scan.scoreBasis}
                size="sm"
              />
            </Link>
          ))}
        </div>
      )}
    </ScreenScaffold>
  );
}
