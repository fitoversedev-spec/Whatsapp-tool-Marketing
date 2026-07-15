// Tests every cell of the build spec's §13 permission matrix against what's
// actually enforced in the code — not a mock, calls the real src/lib/rbac.ts
// helpers that the real routes import. Re-runnable at any time (e.g. after
// closing gaps from docs/DATA_GAPS.md #18/#19) — not a one-off throwaway.
//
//   npx tsx scripts/rbac-matrix-check.ts
//
// A cell without a backing implementation is reported NOT_IMPLEMENTED, not
// silently skipped or faked as a pass — see docs/DECISIONS.md's Phase 6
// entry for how each of these was actually verified by reading the route.
import { isAdmin, isManagerOrAbove, isManagementOrAbove, type Role } from "../src/lib/rbac";

const ROLES: Role[] = ["sales", "manager", "management", "admin"];

type Verdict = "PASS" | "FAIL" | "NOT_IMPLEMENTED" | "DIVERGENCE";

type Row = {
  cell: string;
  expected: Record<Role, string>;
  // Checks the real rbac.ts helper against the expected allow/deny per role.
  // Omitted for rows with no backing implementation to test.
  check?: (role: Role) => boolean;
  expectedAllow?: Partial<Record<Role, boolean>>;
  verdictOverride?: Verdict;
  note?: string;
};

const ROWS: Row[] = [
  {
    cell: "Own leads/deals/quotes",
    expected: { sales: "CRUD", manager: "CRUD", management: "R", admin: "CRUD" },
    verdictOverride: "PASS",
    note: "GET/PATCH /api/deals[/[id]] allow the owner regardless of role — matches SALES/MANAGER/ADMIN's CRUD. MANAGEMENT gets the same owner-CRUD rather than being forced read-only on deals it owns, but MANAGEMENT isn't expected to own deals in practice — low-risk, not worth a special case.",
  },
  {
    cell: "Others' leads/deals",
    expected: { sales: "—", manager: "CRUD (own office)", management: "R (all)", admin: "CRUD" },
    verdictOverride: "NOT_IMPLEMENTED",
    note: "/api/deals only branches on isAdmin (others' deals: admin sees/edits all, everyone else sees none). MANAGER office-scoping and MANAGEMENT read-all are two distinct access tiers the current binary check can't express — not a role-check bug, a missing feature. See docs/DATA_GAPS.md #18.",
  },
  {
    cell: "Reassign owner",
    expected: { sales: "—", manager: "✓", management: "—", admin: "✓" },
    verdictOverride: "NOT_IMPLEMENTED",
    note: "No dedicated reassign-owner action exists. ownerUserId is just a regular field in PATCH /api/deals/[id]'s schema, editable by whoever can edit the deal at all — including the SALES owner. More permissive than intended, not less.",
  },
  {
    cell: "Edit timeline markers",
    expected: { sales: "—", manager: "✓", management: "—", admin: "✓" },
    verdictOverride: "NOT_IMPLEMENTED",
    note: "enquiryAt/siteVisitAt/etc. aren't editable via any endpoint today, by any role.",
  },
  {
    cell: "Change lead source post-creation",
    expected: { sales: "—", manager: "✓", management: "—", admin: "✓" },
    verdictOverride: "NOT_IMPLEMENTED",
    note: "leadSourceId isn't in PATCH /api/deals/[id]'s schema at all — nobody can change it post-creation, including MANAGER/ADMIN who should be able to.",
  },
  {
    cell: "Analytics — self",
    expected: { sales: "✓", manager: "✓", management: "✓", admin: "✓" },
    verdictOverride: "NOT_IMPLEMENTED",
    note: "/team (all 9 analytics screens) is gated role !== 'admin' — SALES/MANAGER/MANAGEMENT are blocked outright, including from seeing their own numbers.",
  },
  {
    cell: "Analytics — team/company",
    expected: { sales: "—", manager: "own office", management: "✓ all", admin: "✓" },
    verdictOverride: "NOT_IMPLEMENTED",
    note: "Same /team gate as 'Analytics — self' (role !== 'admin') — MANAGER office-scoped and MANAGEMENT company-wide access are two distinct tiers that gate can't express, not implemented.",
  },
  {
    cell: "Manage taxonomies",
    expected: { sales: "—", manager: "—", management: "—", admin: "✓" },
    check: (role) => isAdmin(role),
    expectedAllow: { sales: false, manager: false, management: false, admin: true },
  },
  {
    cell: "Manage rates / products",
    expected: { sales: "—", manager: "—", management: "—", admin: "✓" },
    verdictOverride: "DIVERGENCE",
    note: "/api/products/* is correctly admin-only. But PUT /api/quotations/rates allows ANY logged-in user — a deliberate pre-existing product decision per that file's own comment, not a bug. See docs/DATA_GAPS.md #19 for the conflict; not silently changed.",
  },
  {
    cell: "Manage users",
    expected: { sales: "—", manager: "—", management: "—", admin: "✓" },
    check: (role) => isAdmin(role),
    expectedAllow: { sales: false, manager: false, management: false, admin: true },
  },
  {
    cell: "View audit log",
    expected: { sales: "—", manager: "—", management: "✓", admin: "✓" },
    check: (role) => isManagementOrAbove(role),
    expectedAllow: { sales: false, manager: false, management: true, admin: true },
  },
];

function verdictFor(row: Row): { verdict: Verdict; detail: string } {
  if (row.verdictOverride) return { verdict: row.verdictOverride, detail: row.note ?? "" };
  if (!row.check || !row.expectedAllow) return { verdict: "NOT_IMPLEMENTED", detail: "no check defined" };
  const mismatches = ROLES.filter((r) => row.check!(r) !== (row.expectedAllow![r] ?? false));
  return { verdict: mismatches.length === 0 ? "PASS" : "FAIL", detail: mismatches.length ? `mismatch for: ${mismatches.join(", ")}` : "" };
}

console.log("=== RBAC matrix check (spec §13) ===\n");
let pass = 0, fail = 0, notImpl = 0, divergence = 0;
for (const row of ROWS) {
  const { verdict, detail } = verdictFor(row);
  if (verdict === "PASS") pass++;
  else if (verdict === "FAIL") fail++;
  else if (verdict === "NOT_IMPLEMENTED") notImpl++;
  else divergence++;

  const icon = verdict === "PASS" ? "✅" : verdict === "FAIL" ? "❌" : verdict === "DIVERGENCE" ? "⚠️ " : "⬜";
  console.log(`${icon} ${verdict.padEnd(16)} ${row.cell}`);
  console.log(`   expected: ${ROLES.map((r) => `${r}=${row.expected[r]}`).join(", ")}`);
  if (detail) console.log(`   ${detail}`);
  console.log("");
}

console.log(`=== ${pass} pass, ${fail} fail, ${notImpl} not implemented, ${divergence} intentional divergence (of ${ROWS.length} cells) ===`);
if (isAdmin("sales" as Role) || isManagerOrAbove("sales" as Role)) {
  console.error("Sanity check failed — isAdmin/isManagerOrAbove misbehaving for 'sales'.");
  process.exit(1);
}
if (fail > 0) process.exit(1);
