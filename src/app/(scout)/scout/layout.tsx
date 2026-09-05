import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import NavigationTracker from "@/components/NavigationTracker";
import ScoutSidebar from "@/components/ScoutSidebar";
import type { Role } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ScoutLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-slate-50">
      <ScoutSidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as Role,
        }}
      />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto pb-14 lg:pb-0">{children}</main>
      <NavigationTracker />
    </div>
  );
}
