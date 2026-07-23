import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import CrmTabs from "@/components/crm/CrmTabs";
import CrmBadge from "@/components/crm/CrmBadge";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div className="min-h-full">
      {/* Slim band above the tabs so the CRM indicator persists across all
          /crm/* routes regardless of what each page renders below. */}
      <div className="bg-white px-4 sm:px-6 lg:px-8 pt-2.5">
        <CrmBadge />
      </div>
      <CrmTabs isAdmin={!!user && isAdmin(user.role)} />
      {children}
    </div>
  );
}
