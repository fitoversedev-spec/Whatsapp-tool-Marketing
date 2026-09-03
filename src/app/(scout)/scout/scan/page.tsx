import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { publicTaxonomy } from "@/lib/scout/places/taxonomy";
import { ScanScreen } from "./ScanScreen";

export const metadata: Metadata = { title: "Area profile — Site Scout" };
export const dynamic = "force-dynamic";

/**
 * D2, in its "new scan" state.
 *
 * The taxonomy is rendered from `publicTaxonomy()` and never hardcoded: adding
 * a sport is an edit to `src/lib/places/taxonomy.ts` and it appears here with
 * no component change (`docs/PHASE-1-HANDOFF.md` §18).
 */
export default async function ScanPage() {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");
  // 404 rather than 403, the same rule /admin uses: do not confirm the screen exists.
  if (!identity.canRunScans) notFound();

  return (
    <ScanScreen
      taxonomy={publicTaxonomy()}
      initial={null}
      googleKeyMissing={!env.hasGoogleServerKey}
    />
  );
}
