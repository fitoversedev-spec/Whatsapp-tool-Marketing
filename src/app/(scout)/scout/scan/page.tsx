import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BackButton from "@/components/BackButton";
import { getScoutIdentity } from "@/lib/scout/identity";
import { env } from "@/lib/scout/env";
import { publicTaxonomy } from "@/lib/scout/places/taxonomy";
import { ScanScreen } from "./ScanScreen";

export const metadata: Metadata = { title: "Scan Area — Site Scout" };
export const dynamic = "force-dynamic";

/**
 * D2, in its "new scan" state.
 *
 * The taxonomy is rendered from `publicTaxonomy()` and never hardcoded: adding
 * a sport is an edit to `src/lib/places/taxonomy.ts` and it appears here with
 * no component change (`docs/PHASE-1-HANDOFF.md` §18).
 */
export default async function ScanPage({
  searchParams,
}: {
  searchParams: { lat?: string; lng?: string; address?: string };
}) {
  const identity = await getScoutIdentity();
  if (!identity) redirect("/login");
  if (!identity.canRunScans) notFound();

  const lat = searchParams.lat ? parseFloat(searchParams.lat) : NaN;
  const lng = searchParams.lng ? parseFloat(searchParams.lng) : NaN;
  const prefill =
    !isNaN(lat) && !isNaN(lng)
      ? { lat, lng, address: searchParams.address ?? "" }
      : null;

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref={prefill ? "/scout/sweep" : "/scout/dashboard"} />
      </div>
      <ScanScreen
        taxonomy={publicTaxonomy()}
        initial={null}
        googleKeyMissing={!env.hasGoogleServerKey}
        prefill={prefill}
      />
    </>
  );
}
