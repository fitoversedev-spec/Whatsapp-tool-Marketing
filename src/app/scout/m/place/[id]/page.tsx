import { PlaceScreen } from "./PlaceScreen";

export const metadata = { title: "Competitor — Site Scout" };

/**
 * Screen 03, server side.
 *
 * `[id]` is Google's `place_id` — the global identity key Phase 1 uses
 * everywhere — and `?scan=` supplies the plot the distance is measured from.
 * Without it the venue still renders; the distance card does not, which is the
 * honest answer rather than a distance from somewhere unstated.
 */
export default async function PlacePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { scan?: string };
}) {
  const { id } = params;
  const { scan } = searchParams;
  return <PlaceScreen placeId={id} scanId={scan ?? null} />;
}
