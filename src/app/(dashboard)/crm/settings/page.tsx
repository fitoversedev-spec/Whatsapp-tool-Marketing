import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import PageHeader from "@/components/PageHeader";

const LINKS = [
  { href: "/admin/taxonomies", label: "Taxonomies", description: "Funnel stages, lead sources, customer profiles, loss reasons, activity types" },
  { href: "/users", label: "Users", description: "Team members and approval queue" },
  { href: "/admin/audit-log", label: "Audit log", description: "Every stage change, role change, and taxonomy edit" },
];

export default async function CrmSettingsPage() {
  const user = await requireUser();
  if (!isAdmin(user.role)) redirect("/crm");

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <PageHeader large title="CRM settings" description="Admin-only. The full settings surface stays where it already lives — this just gathers the links relevant to the CRM section." />
      <div className="space-y-2 mt-4">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:bg-slate-50">
            <div className="text-base font-medium text-slate-900">{l.label}</div>
            <div className="text-sm text-slate-600 mt-0.5">{l.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
