/**
 * The identity seam's vocabulary.
 *
 * Pure types and pure predicates — no database, no cookies, no `server-only`.
 * Everything here is safe to import from a client component if one ever needs
 * to reason about a permission.
 *
 * ## Why permissions and not a role
 *
 * Site Scout's own auth has two roles, `admin` and `sales`. The host
 * application this tool is being ported into has its own roles, and they are
 * not named the same. Passing `role: "admin" | "sales"` through to feature code
 * would mean translating a foreign role string at every one of the ~40 call
 * sites that ask "may this person do this?".
 *
 * So the seam speaks capabilities instead. The role → capability mapping lives
 * in exactly one place — `./resolver.ts` — and that is the only file the host
 * has to write.
 */

/**
 * Who is asking, and what they are allowed to do.
 *
 * Deliberately three fields. There is no name, no email, no role and no account
 * status: those are either display concerns (see {@link ScoutProfile}) or
 * details of an authentication system the host replaces wholesale.
 */
export interface ScoutIdentity {
  /**
   * Stable, opaque identifier for the person.
   *
   * Site Scout stores it on every row it owns (`scans.owner_id`,
   * `reports.created_by`, the Google API metering log). It is written to the
   * database as a `uuid`, so the host's identifier must be one — see
   * `docs/PORT-A3-HANDOFF.md`.
   */
  userId: string;

  /**
   * May run and read scans: the scan, sweep, compare and report screens, and
   * the APIs behind them.
   *
   * In Site Scout's own auth this is true for every active account, of either
   * role — the checks that consume it are therefore always-true here. They
   * exist so the host has somewhere to say "no".
   */
  canRunScans: boolean;

  /**
   * May reach the administrative area — `/scout/admin` and `/api/scout/admin`.
   *
   * In Site Scout's own auth this is exactly `role === "admin"`.
   */
  canEditScoringWeights: boolean;
}

/**
 * An identity plus the two fields the interface has to show a human.
 *
 * Kept separate from {@link ScoutIdentity} because it is a *display* concern,
 * not an authorisation one: nothing may branch on a display name. It extends
 * `ScoutIdentity` so a profile can be passed anywhere an identity is wanted,
 * and one lookup serves both.
 *
 * Two things genuinely need it: the app shell's avatar, and the "Prepared by"
 * line printed on every generated report.
 */
export interface ScoutProfile extends ScoutIdentity {
  /** Shown in the shell and printed on reports. Never branched on. */
  displayName: string;
  /** Shown in the shell's avatar tooltip. Never branched on. */
  email: string;
}

/**
 * May this identity read and act on scans it does not own?
 *
 * ⚠️ **This is a conflation, and it is deliberate — read before porting.**
 *
 * Site Scout has a third capability that the seam's three fields do not name:
 * an admin sees the whole desk, a salesperson sees only their own scans. It is
 * checked at sixteen call sites across fourteen files (`src/lib/scans/queries.ts`,
 * `src/lib/scans/screenData.ts`, `src/lib/reports/*`, the `(app)/sweep` page and
 * the `api/scans/[id]/*` handlers), and before this seam existed every one of
 * them read `user.role === "admin"`.
 *
 * `ScoutIdentity` was specified with two permissions, so rather than invent a
 * third field or scatter a role check back across all of them, the
 * bypass is derived from `canEditScoringWeights` — which in Site Scout's own
 * auth is precisely "is an admin", making this behaviour-identical here.
 *
 * The cost is that in the host, any role granted the admin area also gains
 * visibility of everyone's scans. If the host wants those separated, this
 * function is the single line to change (and `ScoutIdentity` grows a third
 * field). Nothing else moves.
 */
export function canAccessAllScans(identity: ScoutIdentity): boolean {
  return identity.canEditScoringWeights;
}
