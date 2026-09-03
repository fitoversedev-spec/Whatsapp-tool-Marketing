import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getScoutIdentity } from "@/lib/scout/identity";

export const dynamic = "force-dynamic";

/**
 * Permission gate for every /admin route.
 *
 * A caller without `canEditScoringWeights` gets a 404, not a 403 — there is no
 * reason to confirm to them that the admin area exists at this path.
 *
 * Admin gate 1 of 3. The other two are `./actions.ts` — the server actions
 * behind this area's forms — and `src/app/api/scout/admin/usage/route.ts`.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const identity = await getScoutIdentity();
  if (!identity?.canEditScoringWeights) notFound();
  return <>{children}</>;
}
