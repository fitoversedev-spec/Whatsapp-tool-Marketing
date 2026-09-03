/**
 * The identity seam.
 *
 * Feature code — pages, route handlers, server actions, the scan and report
 * libraries — asks this module "who is calling, and what may they do?" and gets
 * back a {@link ScoutIdentity}. It never learns which authentication system
 * answered, and it never sees a role string.
 *
 * ```ts
 * import { getScoutIdentity } from "@/lib/scout/identity";
 *
 * const identity = await getScoutIdentity();
 * if (!identity) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
 * if (!identity.canRunScans) return NextResponse.json({ error: "Not permitted." }, { status: 403 });
 * ```
 *
 * ## What is on which side of the seam
 *
 * - **Behind it**: `src/lib/identity/resolver.ts`, and through it `src/lib/auth/`
 *   and the `users` / `sessions` / `signup_attempts` tables. The host replaces
 *   the resolver; the rest goes away with it.
 * - **In front of it**: everything else.
 *
 * Auth's own internals — `src/lib/auth/{login,password,signup,session}.ts`,
 * `src/app/(auth)/actions.ts`, `src/app/api/scout/auth/signout/route.ts` — keep
 * importing `@/lib/scout/auth` directly. They are not asking who the caller is; they
 * are the thing that decides it.
 *
 * `src/middleware.ts` also stays on `@/lib/scout/auth/cookie-name`. It runs on the
 * edge, cannot reach Postgres, and only checks that *a* cookie is present as a
 * redirect optimisation. The authoritative check is this seam, in the layouts
 * and handlers that run on Node.
 */

export { canAccessAllScans } from "./types";
export type { ScoutIdentity, ScoutProfile } from "./types";
export { getScoutIdentity, getScoutProfile } from "./resolver";

import { getScoutIdentity, getScoutProfile } from "./resolver";
import type { ScoutIdentity, ScoutProfile } from "./types";

/**
 * The current caller, or a thrown error.
 *
 * For call sites where "not signed in" is not a case to render but a bug to
 * surface — server actions, which are reachable as POST endpoints no matter
 * what the UI drew, and which have no sensible response body.
 *
 * Everywhere that *does* have a sensible response — a 401 body, a 404 to avoid
 * confirming a resource exists, a redirect to `/login` — calls
 * {@link getScoutIdentity} and handles `null` itself. Those responses are not
 * interchangeable, so the seam does not choose between them.
 */
export async function requireScoutIdentity(): Promise<ScoutIdentity> {
  const identity = await getScoutIdentity();
  if (!identity) throw new Error("Not authorised.");
  return identity;
}

/** {@link requireScoutIdentity}, with the display fields. */
export async function requireScoutProfile(): Promise<ScoutProfile> {
  const profile = await getScoutProfile();
  if (!profile) throw new Error("Not authorised.");
  return profile;
}
