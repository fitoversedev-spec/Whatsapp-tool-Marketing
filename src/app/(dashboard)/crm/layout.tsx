import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import CrmTabs from "@/components/crm/CrmTabs";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div className="min-h-full">
      {/* The "CRM" context badge now lives tool-wide in the sidebar
          (components/SectionBadge), so no per-area band is rendered here. */}
      <CrmTabs isAdmin={!!user && isAdmin(user.role)} />
      {children}
    </div>
  );
}
