import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/scout/patterns";
import { getScoutProfile } from "@/lib/scout/identity";

export const dynamic = "force-dynamic";

/**
 * The authoritative gate. The edge middleware only checks that a cookie is
 * present; this runs on the Node runtime, resolves the identity through the
 * seam, and is what actually keeps non-active accounts out.
 *
 * There is no `status` branch here any more, and nothing is lost by that: the
 * resolver only ever returns an identity for an account that may sign in.
 * `validateSessionToken` returns `null` for a `pending` or `rejected` user, and
 * a session is never minted for one in the first place — `loginAction` sends
 * those two cases to `/pending` without setting a cookie. The old
 * `redirect("/pending")` on this line could not fire.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await getScoutProfile();
  if (!profile) redirect("/login");

  return (
    <AppShell
      user={{
        name: profile.displayName,
        email: profile.email,
        canEditScoringWeights: profile.canEditScoringWeights,
      }}
    >
      {children}
    </AppShell>
  );
}
