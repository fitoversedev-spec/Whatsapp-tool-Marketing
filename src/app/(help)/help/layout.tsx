import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import NavigationTracker from "@/components/NavigationTracker";
import HelpSidebar from "@/components/HelpSidebar";
import type { Role } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function HelpLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-slate-50">
      <HelpSidebar
        user={{
          name: user.name,
          email: user.email,
          role: user.role as Role,
        }}
      />
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto pb-14 md:pb-0">
        {children}
      </main>
      <NavigationTracker />
    </div>
  );
}
