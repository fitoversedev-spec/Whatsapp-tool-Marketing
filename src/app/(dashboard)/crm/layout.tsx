import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import CrmTabs from "@/components/crm/CrmTabs";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div className="min-h-full">
      <CrmTabs isAdmin={!!user && isAdmin(user.role)} />
      {children}
    </div>
  );
}
