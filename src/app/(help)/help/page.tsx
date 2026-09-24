import { requireUser } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { entriesForRole } from "@/lib/help/registry";
import GuideClient from "./GuideClient";

export const dynamic = "force-dynamic";

export default async function HelpPage({
  searchParams,
}: {
  searchParams: { section?: string; q?: string; entry?: string };
}) {
  const user = await requireUser();
  const entries = entriesForRole(user.role as Role);

  return (
    <GuideClient
      entries={entries}
      initialSection={searchParams.section ?? null}
      initialQuery={searchParams.q ?? ""}
      initialEntry={searchParams.entry ?? null}
      userRole={user.role as Role}
    />
  );
}
