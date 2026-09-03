import { publicTaxonomy } from "@/lib/scout/places/taxonomy";
import { ScanScreen, type PublicTaxonomy } from "./ScanScreen";

export const metadata = { title: "Site check — Site Scout" };

/**
 * Screen 01, server side.
 *
 * The taxonomy is read here rather than fetched over HTTP: it is a pure
 * function of committed code, so a round trip to `/api/scout/scans/estimate?taxonomy=1`
 * would add a request to the critical path of the app's first screen for no new
 * information.
 *
 * `publicTaxonomy()` — not `CATEGORIES` — because that is the projection that
 * omits the Google search strings. Those are a commercial detail of how the
 * scan is built and have no business in a browser bundle.
 */
export default function ScanPage() {
  const taxonomy = publicTaxonomy() as PublicTaxonomy;
  return <ScanScreen taxonomy={taxonomy} />;
}
